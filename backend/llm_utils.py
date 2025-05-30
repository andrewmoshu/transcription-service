import os
from dotenv import load_dotenv
from langchain_google_vertexai import ChatVertexAI
from langchain_core.prompts import PromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain.chains import LLMChain
from langchain.memory import ConversationBufferMemory

load_dotenv()

# For ChatVertexAI, we use Vertex AI with service account authentication
# Set GOOGLE_APPLICATION_CREDENTIALS environment variable to point to your service account JSON file
# and GOOGLE_CLOUD_PROJECT to your GCP project ID

# Check if we have the necessary environment variables for Vertex AI
google_cloud_project = os.getenv("GOOGLE_CLOUD_PROJECT")

if not google_cloud_project:
    raise EnvironmentError(
        "GOOGLE_CLOUD_PROJECT environment variable must be set for ChatVertexAI. "
        "Also ensure GOOGLE_APPLICATION_CREDENTIALS points to your service account JSON file."
    )

# Initialize the ChatVertexAI model
# Using gemini-1.5-flash-001 (a stable Vertex AI model)
# Temperature is set to a low value for more deterministic outputs for summaries/notes,
# but can be adjusted or made configurable.

llm = ChatVertexAI(
    model="gemini-2.5-flash-preview-05-20", 
    temperature=0.2,
    project=google_cloud_project,
    location=os.getenv("GOOGLE_CLOUD_LOCATION", "us-central1")
)
print("Using ChatVertexAI with service account authentication")

def generate_meeting_takeaways(transcript: str) -> str:
    """Generates concise meeting takeaways from the transcript."""
    prompt_template = PromptTemplate(
        input_variables=["transcript"],
        template="""
        Based on the following meeting transcript, please extract the key meeting takeaways or action items.
        Present them as a clear, concise bulleted list.

        Transcript:
        {transcript}

        Key Takeaways:
        """
    )
    chain = LLMChain(llm=llm, prompt=prompt_template)
    response = chain.invoke({"transcript": transcript})
    return response['text']

def generate_meeting_summary(transcript: str) -> str:
    """Generates a summary of the meeting from the transcript."""
    prompt_template = PromptTemplate(
        input_variables=["transcript"],
        template="""
        Please provide a concise summary of the following meeting transcript.
        Capture the main topics discussed and any important decisions made.

        Transcript:
        {transcript}

        Summary:
        """
    )
    chain = LLMChain(llm=llm, prompt=prompt_template)
    response = chain.invoke({"transcript": transcript})
    return response['text']

def generate_meeting_notes(transcript: str) -> str:
    """Generates detailed meeting notes from the transcript."""
    prompt_template = PromptTemplate(
        input_variables=["transcript"],
        template="""
        From the following meeting transcript, create detailed meeting notes.
        Include discussion points, decisions, and any assigned tasks with responsible parties if mentioned.
        Structure the notes logically, perhaps by topic or speaker if discernible.

        Transcript:
        {transcript}

        Detailed Meeting Notes:
        """
    )
    chain = LLMChain(llm=llm, prompt=prompt_template)
    response = chain.invoke({"transcript": transcript})
    return response['text']

# For the chat functionality, we'll set up a conversational chain
# This requires memory to keep track of the conversation.

def get_chat_response(transcript: str, user_question: str, memory: ConversationBufferMemory) -> str:
    """Generates a response to a user's question about the meeting transcript."""
    # We need to provide the transcript as context for every question.
    # The memory will store the history of Q&A.

    # Check if this is the first question. If so, prime the memory with the context.
    # This is a simplified way. A more robust way would be to use a proper contextual QA chain.
    if not memory.chat_memory.messages: # If memory is empty
        # Add a system message or initial context to the memory if desired, though not strictly required here
        # as the transcript is passed directly to the prompt each time.
        pass 

    # For this specific use case, where questions are *about* the transcript,
    # the transcript itself is the primary context, not just conversation history.
    # Langchain's `ConversationChain` might not be ideal if we always want to ground answers
    # in the *static* transcript rather than evolving conversation that might drift.
    # A more direct approach for Q&A on a fixed document:

    prompt_template = PromptTemplate(
        input_variables=["transcript", "user_question", "chat_history"],
        template="""
        You are a helpful assistant answering questions about a meeting.
        Use the provided meeting transcript to answer the user's question.
        If the transcript doesn't contain the answer, say so.

        Meeting Transcript:
        {transcript}

        Chat History:
        {chat_history}

        User Question: {user_question}
        Assistant Answer:
        """
    )

    # We'll manually manage the history string for the prompt for simplicity here,
    # as `ConversationChain` with just `ConversationBufferMemory` might not directly allow injecting
    # a large, static context (the transcript) easily into each turn alongside the dynamic chat history.
    
    # Construct chat history string from memory
    history_string = "\n".join([f"{msg.type}: {msg.content}" for msg in memory.chat_memory.messages])

    chain = LLMChain(llm=llm, prompt=prompt_template)
    
    # Prepare inputs for the chain
    inputs = {
        "transcript": transcript,
        "user_question": user_question,
        "chat_history": history_string
    }
    
    response = chain.invoke(inputs)
    answer = response['text']
    
    # Update memory with the current Q&A
    memory.save_context({"input": user_question}, {"output": answer})
    
    return answer


if __name__ == '__main__':
    # This is a simple test section. 
    # In a real scenario, you'd get the transcript from the transcription module.
    print("Testing LLM utility functions...")
    dummy_transcript = """
    [00:00:00] Speaker A: Good morning, everyone. Today we're discussing the Q3 project update.
    [00:00:05] Speaker B: Thanks. I've reviewed the initial draft. Looks promising.
    [00:00:10] Speaker A: Great. Key milestones are on track. We need to finalize the budget by Friday.
    [00:00:15] Speaker C: I'll send out the revised budget proposal this afternoon.
    [00:00:20] Speaker A: Perfect. Any blockers?
    [00:00:22] Speaker B: Resource allocation for the design phase is a bit tight.
    [00:00:25] Speaker A: Okay, let's sync on that offline, Speaker B and C.
    [00:00:30] Speaker A: Meeting adjourned. Thanks all.
    """

    print("\n--- Generating Takeaways ---")
    takeaways = generate_meeting_takeaways(dummy_transcript)
    print(takeaways)

    print("\n--- Generating Summary ---")
    summary = generate_meeting_summary(dummy_transcript)
    print(summary)

    print("\n--- Generating Notes ---")
    notes = generate_meeting_notes(dummy_transcript)
    print(notes)

    print("\n--- Testing Chat Functionality ---")
    chat_memory = ConversationBufferMemory()
    q1 = "Who is responsible for the budget?"
    print(f"User: {q1}")
    a1 = get_chat_response(dummy_transcript, q1, chat_memory)
    print(f"Assistant: {a1}")

    q2 = "What was the main topic of discussion?"
    print(f"User: {q2}")
    a2 = get_chat_response(dummy_transcript, q2, chat_memory)
    print(f"Assistant: {a2}")

    q3 = "When is the budget due?"
    print(f"User: {q3}")
    a3 = get_chat_response(dummy_transcript, q3, chat_memory)
    print(f"Assistant: {a3}")

    print("\n--- Chat History for reference ---")
    for msg in chat_memory.chat_memory.messages:
        print(f"{msg.type.upper()}: {msg.content}")
    print("--------------------------------") 
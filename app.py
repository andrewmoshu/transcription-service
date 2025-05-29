import streamlit as st
import os
import tempfile
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Conditional import for pydub for MIME type detection if needed
# Though Streamlit's UploadedFile object has a `type` attribute.
try:
    from pydub import AudioSegment
    PYDUB_AVAILABLE = True
except ImportError:
    PYDUB_AVAILABLE = False
    st.warning("Pydub is not installed. MIME type detection for some audio formats might be limited. Consider `pip install pydub` if you encounter issues with audio file types.")

# Import project modules
from transcription import transcribe_audio
from llm_utils import (
    generate_meeting_takeaways,
    generate_meeting_summary,
    generate_meeting_notes,
    get_chat_response
)
from langchain.memory import ConversationBufferMemory

# Page configuration
st.set_page_config(layout="wide", page_title="Meeting Analyzer Chatbot")

st.title("🎙️ Meeting Analyzer & Chatbot")
st.markdown("Upload your meeting audio file to get a transcription, summary, takeaways, notes, and chat about its content.")
st.markdown("Powered by Google Gemini 2.5 Flash.")

# --- Helper Functions ---
SUPPORTED_AUDIO_TYPES = {
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a", # m4a is often audio/mp4
    "audio/x-m4a": "m4a",
    "audio/flac": "flac",
    "audio/aac": "aac",
    "audio/ogg": "ogg", # common for opus
    "audio/opus": "opus",
    "audio/webm": "webm",
    # Add more as supported by Gemini API and pydub if used for validation
}

def get_mime_type(file_name: str, uploaded_file_type: str) -> str:
    """Determines the MIME type, prioritizing Streamlit's type, then extension."""
    if uploaded_file_type and uploaded_file_type in SUPPORTED_AUDIO_TYPES:
        return uploaded_file_type
    
    # Fallback to extension if Streamlit type is generic or not recognized
    ext = os.path.splitext(file_name)[1].lower()
    if ext == ".mp3": return "audio/mpeg"
    if ext == ".wav": return "audio/wav"
    if ext == ".m4a": return "audio/mp4" # or audio/x-m4a
    if ext == ".flac": return "audio/flac"
    if ext == ".aac": return "audio/aac"
    if ext == ".ogg": return "audio/ogg"
    if ext == ".opus": return "audio/opus"
    if ext == ".webm": return "audio/webm"
    
    st.warning(f"Could not confidently determine MIME type for {file_name} (type: {uploaded_file_type}). Attempting generic audio/mpeg. This might fail.")
    return "audio/mpeg" # Default or raise error

def parse_chapter_transcript(transcript: str) -> list:
    """
    Parses a chapter-based transcript into sections.
    
    Args:
        transcript: The full transcript text with CHAPTER: markers
        
    Returns:
        List of dictionaries with 'title', 'time_range', and 'content' keys
    """
    if not transcript or transcript.startswith("Error:"):
        return []
    
    chapters = []
    current_chapter = None
    current_content = []
    
    lines = transcript.split('\n')
    
    for line in lines:
        line = line.strip()
        if line.startswith('CHAPTER:'):
            # Save previous chapter if exists
            if current_chapter:
                chapters.append({
                    'title': current_chapter['title'],
                    'time_range': current_chapter['time_range'],
                    'content': '\n'.join(current_content).strip()
                })
            
            # Parse new chapter
            chapter_line = line[8:].strip()  # Remove 'CHAPTER:' prefix
            
            # Try to extract title and time range
            if '(' in chapter_line and ')' in chapter_line:
                title = chapter_line[:chapter_line.rfind('(')].strip()
                time_range = chapter_line[chapter_line.rfind('('):].strip('()')
            else:
                title = chapter_line
                time_range = "Time not specified"
            
            current_chapter = {
                'title': title,
                'time_range': time_range
            }
            current_content = []
        else:
            if line:  # Add non-empty lines to current chapter content
                current_content.append(line)
    
    # Add the last chapter
    if current_chapter:
        chapters.append({
            'title': current_chapter['title'],
            'time_range': current_chapter['time_range'],
            'content': '\n'.join(current_content).strip()
        })
    
    # If no chapters were found, treat the entire transcript as one chapter
    if not chapters and transcript:
        chapters.append({
            'title': "Full Meeting Transcript",
            'time_range': "Complete Duration",
            'content': transcript.strip()
        })
    
    return chapters

def display_chapter_transcript(transcript: str):
    """
    Displays the transcript in collapsible chapter sections.
    
    Args:
        transcript: The full transcript text
    """
    chapters = parse_chapter_transcript(transcript)
    
    if not chapters:
        st.info("No transcript content available.")
        return
    
    # Add search functionality
    col1, col2 = st.columns([3, 1])
    
    with col1:
        search_term = st.text_input("🔍 Search in transcript", placeholder="Enter keywords to search...")
    
    with col2:
        st.write("")  # Add some spacing
        total_chapters = len(chapters)
        st.metric("Chapters", total_chapters)
    
    st.markdown("### 📚 Meeting Chapters")
    
    # Filter chapters based on search term
    filtered_chapters = chapters
    if search_term:
        filtered_chapters = []
        for chapter in chapters:
            if (search_term.lower() in chapter['title'].lower() or 
                search_term.lower() in chapter['content'].lower()):
                filtered_chapters.append(chapter)
        
        if filtered_chapters:
            st.success(f"Found {len(filtered_chapters)} chapter(s) containing '{search_term}'")
        else:
            st.warning(f"No chapters found containing '{search_term}'")
    
    for i, chapter in enumerate(filtered_chapters):
        # Create expander with chapter title and time range
        # Expand first chapter by default, or all if searching
        expanded = (i == 0) if not search_term else True
        
        with st.expander(f"**{chapter['title']}** ({chapter['time_range']})", expanded=expanded):
            if chapter['content']:
                # Format the content with better styling
                formatted_content = chapter['content'].replace('\n\n', '\n').strip()
                
                # Highlight search terms if searching
                if search_term:
                    # Simple highlighting by making search terms bold
                    import re
                    pattern = re.compile(re.escape(search_term), re.IGNORECASE)
                    formatted_content = pattern.sub(f"**{search_term.upper()}**", formatted_content)
                
                # Apply some basic formatting to make timestamps stand out
                lines = formatted_content.split('\n')
                formatted_lines = []
                
                for line in lines:
                    line = line.strip()
                    if line:
                        # Check if line starts with timestamp pattern [HH:MM:SS]
                        if line.startswith('[') and ']' in line:
                            # Split timestamp and content
                            parts = line.split(']', 1)
                            if len(parts) == 2:
                                timestamp = parts[0] + ']'
                                content = parts[1].strip()
                                # Format with timestamp in blue and content in normal text
                                formatted_lines.append(f"🕐 **{timestamp}** {content}")
                            else:
                                formatted_lines.append(line)
                        else:
                            formatted_lines.append(line)
                
                formatted_text = '\n\n'.join(formatted_lines)
                st.markdown(formatted_text)
            else:
                st.info("No content available for this chapter.")
    
    # Add a summary at the bottom
    if not search_term:
        st.markdown(f"---")
        st.caption(f"📊 This meeting contains **{total_chapters}** chapters total")

# --- Session State Initialization ---
if "transcript" not in st.session_state:
    st.session_state.transcript = None
if "takeaways" not in st.session_state:
    st.session_state.takeaways = None
if "summary" not in st.session_state:
    st.session_state.summary = None
if "notes" not in st.session_state:
    st.session_state.notes = None
if "processing_complete" not in st.session_state:
    st.session_state.processing_complete = False
if "error_message" not in st.session_state:
    st.session_state.error_message = None
if "uploaded_file_name" not in st.session_state:
    st.session_state.uploaded_file_name = None

# Chat specific session state
if "chat_memory" not in st.session_state:
    st.session_state.chat_memory = ConversationBufferMemory(memory_key="chat_history", return_messages=True)
if "chat_messages" not in st.session_state: # For displaying chat history in UI
    st.session_state.chat_messages = []

# --- UI Components --- 

# Sidebar for File Upload
with st.sidebar:
    st.header("Upload Audio File")
    uploaded_file = st.file_uploader(
        "Choose an audio file", 
        type=list(SUPPORTED_AUDIO_TYPES.values()), # Use extensions for file picker filter
        # accept_multiple_files=False # Default is False
    )

    if uploaded_file is not None:
        if st.button("Process Meeting Audio"):
            # Clear previous results and errors
            st.session_state.transcript = None
            st.session_state.takeaways = None
            st.session_state.summary = None
            st.session_state.notes = None
            st.session_state.processing_complete = False
            st.session_state.error_message = None
            st.session_state.chat_messages = [] # Reset chat on new file
            st.session_state.chat_memory.clear() # Clear Langchain memory
            st.session_state.uploaded_file_name = uploaded_file.name

            with st.spinner(f"Processing {uploaded_file.name}... This may take a few minutes for large files."):
                try:
                    # Save uploaded file to a temporary path for the SDK
                    with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(uploaded_file.name)[1]) as tmp_file:
                        tmp_file.write(uploaded_file.getvalue())
                        tmp_file_path = tmp_file.name
                    
                    # Determine MIME type
                    # Streamlit's UploadedFile object has a `type` attribute which is often the MIME type.
                    mime_type = get_mime_type(uploaded_file.name, uploaded_file.type)
                    st.info(f"Detected MIME type: {mime_type} for file: {uploaded_file.name}")

                    # 1. Transcription
                    st.write("Transcribing audio...")
                    transcript_text = transcribe_audio(tmp_file_path, mime_type)
                    if transcript_text and not transcript_text.startswith("Error:"):
                        st.session_state.transcript = transcript_text
                        st.success("Transcription complete!")
                    else:
                        st.session_state.error_message = transcript_text or "Transcription failed. No transcript generated."
                        st.error(st.session_state.error_message)
                        os.remove(tmp_file_path) # Clean up temp file
                        st.stop()

                    # 2. Generate Takeaways, Summary, Notes (if transcription successful)
                    if st.session_state.transcript:
                        st.write("Generating takeaways...")
                        st.session_state.takeaways = generate_meeting_takeaways(st.session_state.transcript)
                        st.write("Generating summary...")
                        st.session_state.summary = generate_meeting_summary(st.session_state.transcript)
                        st.write("Generating notes...")
                        st.session_state.notes = generate_meeting_notes(st.session_state.transcript)
                        st.session_state.processing_complete = True
                        st.success("All processing complete!")
                    
                    os.remove(tmp_file_path) # Clean up temp file

                except Exception as e:
                    st.session_state.error_message = f"An unexpected error occurred: {str(e)}"
                    st.error(st.session_state.error_message)
                    if 'tmp_file_path' in locals() and os.path.exists(tmp_file_path):
                        os.remove(tmp_file_path)
    else:
        st.info("Upload an audio file and click 'Process Meeting Audio' to begin.")

# Main content area with tabs
tab_titles = ["📝 Transcription", "📌 Takeaways", "📄 Summary", "🗒️ Notes", "💬 Chat about the Meeting"]
tab1, tab2, tab3, tab4, tab5 = st.tabs(tab_titles)

with tab1:
    st.header("📝 Meeting Transcription")
    if st.session_state.transcript:
        display_chapter_transcript(st.session_state.transcript)
    elif st.session_state.error_message:
        st.error(f"Could not display transcript due to an error: {st.session_state.error_message}")
    elif st.session_state.uploaded_file_name:
        st.info(f"Transcription for '{st.session_state.uploaded_file_name}' is being processed or was not successful.")
    else:
        st.info("Upload and process an audio file to see the chapter-organized transcription here.")

with tab2:
    st.header("Key Takeaways")
    if st.session_state.takeaways:
        st.markdown(st.session_state.takeaways)
    elif st.session_state.processing_complete and not st.session_state.takeaways:
         st.warning("Takeaways could not be generated for the provided transcript.")
    elif st.session_state.uploaded_file_name and not st.session_state.transcript:
        st.info("Process an audio file successfully to generate takeaways.")
    else:
        st.info("Upload and process an audio file to see key takeaways here.")

with tab3:
    st.header("Meeting Summary")
    if st.session_state.summary:
        st.markdown(st.session_state.summary)
    elif st.session_state.processing_complete and not st.session_state.summary:
         st.warning("Summary could not be generated for the provided transcript.")
    elif st.session_state.uploaded_file_name and not st.session_state.transcript:
        st.info("Process an audio file successfully to generate a summary.")
    else:
        st.info("Upload and process an audio file to see the summary here.")

with tab4:
    st.header("Detailed Notes")
    if st.session_state.notes:
        st.markdown(st.session_state.notes)
    elif st.session_state.processing_complete and not st.session_state.notes:
         st.warning("Notes could not be generated for the provided transcript.")
    elif st.session_state.uploaded_file_name and not st.session_state.transcript:
        st.info("Process an audio file successfully to generate notes.")
    else:
        st.info("Upload and process an audio file to see detailed notes here.")

with tab5:
    st.header("Chat about the Meeting")
    if not st.session_state.transcript:
        st.info("Please upload and process an audio file first to enable the chat.")
    else:
        st.markdown(f"Ask questions about the meeting: **{st.session_state.uploaded_file_name}**")
        
        # Display chat messages
        for msg in st.session_state.chat_messages:
            with st.chat_message(msg["role"]):
                st.markdown(msg["content"])

        # Chat input
        if prompt := st.chat_input("Ask a question about the meeting..."):
            # Add user message to chat history
            st.session_state.chat_messages.append({"role": "user", "content": prompt})
            with st.chat_message("user"):
                st.markdown(prompt)

            # Get assistant response
            with st.chat_message("assistant"):
                with st.spinner("Thinking..."):
                    try:
                        full_response = get_chat_response(
                            transcript=st.session_state.transcript,
                            user_question=prompt,
                            memory=st.session_state.chat_memory
                        )
                        st.markdown(full_response)
                        st.session_state.chat_messages.append({"role": "assistant", "content": full_response})
                    except Exception as e:
                        error_msg = f"Error getting chat response: {str(e)}"
                        st.error(error_msg)
                        st.session_state.chat_messages.append({"role": "assistant", "content": error_msg})

# Display any general error messages at the bottom
if st.session_state.error_message and not st.session_state.processing_complete:
    st.sidebar.error(f"Last Error: {st.session_state.error_message}") 
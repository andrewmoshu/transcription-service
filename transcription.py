from google import genai
from google.genai.types import GenerateContentConfig, Part,HttpOptions
import os
from dotenv import load_dotenv
from google.cloud import storage
import uuid

load_dotenv()

def upload_to_gcs(local_file_path: str, project_id: str) -> str:
    """
    Uploads a file to Google Cloud Storage and returns the gs:// URI.
    
    Args:
        local_file_path: Path to the local file
        project_id: Google Cloud Project ID
        
    Returns:
        The gs:// URI of the uploaded file
    """
    # Create a unique bucket name for this project if it doesn't exist
    bucket_name = f"{project_id}-transcriber-temp"
    
    # Initialize the storage client
    storage_client = storage.Client(project=project_id)
    
    try:
        # Try to get the bucket, create if it doesn't exist
        try:
            bucket = storage_client.bucket(bucket_name)
            bucket.reload()  # Check if bucket exists
        except Exception:
            # Create bucket if it doesn't exist
            bucket = storage_client.create_bucket(bucket_name)
            print(f"Created bucket: {bucket_name}")
    except Exception as e:
        print(f"Error with bucket {bucket_name}: {e}")
        # Fallback to a more unique bucket name
        bucket_name = f"{project_id}-transcriber-{uuid.uuid4().hex[:8]}"
        bucket = storage_client.create_bucket(bucket_name)
        print(f"Created fallback bucket: {bucket_name}")
    
    # Generate a unique object name
    file_extension = os.path.splitext(local_file_path)[1]
    object_name = f"audio-{uuid.uuid4().hex}{file_extension}"
    
    # Upload the file
    blob = bucket.blob(object_name)
    blob.upload_from_filename(local_file_path)
    
    gs_uri = f"gs://{bucket_name}/{object_name}"
    print(f"File uploaded to: {gs_uri}")
    
    return gs_uri

def delete_from_gcs(gs_uri: str, project_id: str):
    """
    Deletes a file from Google Cloud Storage.
    
    Args:
        gs_uri: The gs:// URI of the file to delete
        project_id: Google Cloud Project ID
    """
    try:
        # Parse the gs:// URI
        if not gs_uri.startswith("gs://"):
            return
            
        uri_parts = gs_uri[5:].split("/", 1)  # Remove gs:// and split
        bucket_name = uri_parts[0]
        object_name = uri_parts[1]
        
        storage_client = storage.Client(project=project_id)
        bucket = storage_client.bucket(bucket_name)
        blob = bucket.blob(object_name)
        blob.delete()
        
        print(f"Deleted file: {gs_uri}")
    except Exception as e:
        print(f"Warning: Could not delete file {gs_uri}: {e}")

def transcribe_audio(audio_file_path: str, mime_type: str) -> str:
    """
    Transcribes the given audio file using the Gemini API via Vertex AI.

    Args:
        audio_file_path: Path to the audio file.
        mime_type: The MIME type of the audio file (e.g., "audio/mpeg", "audio/wav").

    Returns:
        The transcribed text.
    """
    project_id = os.getenv("GOOGLE_CLOUD_PROJECT")
    location = os.getenv("GOOGLE_CLOUD_LOCATION")

    # For Vertex AI, we need GOOGLE_CLOUD_PROJECT
    if not project_id:
        raise ValueError("GOOGLE_CLOUD_PROJECT environment variable not set. Required for Vertex AI.")
    if not location:
        print("Warning: GOOGLE_CLOUD_LOCATION not set, defaulting to 'us-central1'.")
        location = "us-central1"

    # Set environment variables for Vertex AI SDK integration
    os.environ["GOOGLE_CLOUD_PROJECT"] = project_id
    os.environ["GOOGLE_CLOUD_LOCATION"] = location
    os.environ["GOOGLE_GENAI_USE_VERTEXAI"] = "True"

    gs_uri = None
    try:
        # Upload file to Google Cloud Storage first
        print(f"Uploading file to Google Cloud Storage: {audio_file_path}")
        gs_uri = upload_to_gcs(audio_file_path, project_id)
        
        # Initialize the Vertex AI client
        main_client = genai.Client(http_options=HttpOptions(api_version="v1"))

        prompt = """Please transcribe this meeting audio with the following structure:

1. First, identify the main topics/chapters discussed in the meeting
2. For each chapter, provide:
   - Chapter title and time range (e.g., "Opening Remarks (00:00 - 03:00)")
   - Detailed transcription with timestamps, speakers, and content
3. Format each speaker's dialogue with proper timestamps
4. Use clear section breaks between chapters

Structure your response as:

CHAPTER: [Chapter Title] ([Start Time] - [End Time])
[Detailed transcription for this chapter with timestamps and speakers]

CHAPTER: [Next Chapter Title] ([Start Time] - [End Time])  
[Detailed transcription for this chapter with timestamps and speakers]

Use speaker A, speaker B, etc. to identify speakers consistently throughout."""

        # Use Part.from_uri with the gs:// URI for Vertex AI
        print(f"Using Vertex AI with gs:// URI: {gs_uri}")
        
        response = main_client.models.generate_content(
            model="gemini-2.5-flash-preview-05-20",
            contents=[
                prompt,
                Part.from_uri(file_uri=gs_uri, mime_type=mime_type)
            ],
            config=GenerateContentConfig(audio_timestamp=True),
        )
        
        # Clean up the uploaded file
        if gs_uri:
            delete_from_gcs(gs_uri, project_id)

        if response.candidates and response.candidates[0].content.parts:
            return response.candidates[0].content.parts[0].text
        else:
            if response.prompt_feedback:
                print(f"Prompt Feedback: {response.prompt_feedback}")
            if response.candidates and response.candidates[0].finish_reason:
                 print(f"Finish Reason: {response.candidates[0].finish_reason}")
                 if response.candidates[0].safety_ratings:
                     print(f"Safety Ratings: {response.candidates[0].safety_ratings}")

            return "Error: Could not transcribe audio. The response was empty or an error occurred."

    except Exception as e:
        print(f"An error occurred during transcription: {e}")
        
        # Clean up the uploaded file if it exists
        if gs_uri:
            delete_from_gcs(gs_uri, project_id)
        
        # Try with the specific model version as fallback
        print("Retrying with specific model version: models/gemini-2.5-flash-preview-05-20")
        gs_uri_retry = None
        try:
            # Re-upload for the retry
            print(f"Re-uploading file for retry: {audio_file_path}")
            gs_uri_retry = upload_to_gcs(audio_file_path, project_id)

            response_retry = main_client.models.generate_content(
                model="gemini-2.5-flash-preview-05-20",
                contents=[
                    prompt,
                    Part.from_uri(file_uri=gs_uri_retry, mime_type=mime_type)
                ],
                config=GenerateContentConfig(audio_timestamp=True),
            )

            # Clean up the retry uploaded file
            if gs_uri_retry:
                delete_from_gcs(gs_uri_retry, project_id)

            if response_retry.candidates and response_retry.candidates[0].content.parts:
                return response_retry.candidates[0].content.parts[0].text
            else:
                print("Retry failed. Full response for debugging:", response_retry)
                if response_retry.prompt_feedback:
                    print(f"Prompt Feedback (Retry): {response_retry.prompt_feedback}")
                if response_retry.candidates and response_retry.candidates[0].finish_reason:
                     print(f"Finish Reason (Retry): {response_retry.candidates[0].finish_reason}")
                     if response_retry.candidates[0].safety_ratings:
                         print(f"Safety Ratings (Retry): {response_retry.candidates[0].safety_ratings}")
                return f"Error: Could not transcribe audio after retry. Original error: {str(e)}"

        except Exception as e_retry:
            print(f"An error occurred during transcription retry: {e_retry}")
            # Clean up the retry uploaded file if it exists
            if gs_uri_retry:
                delete_from_gcs(gs_uri_retry, project_id)
            return f"Error: Could not transcribe audio. Failed on initial attempt and retry. Initial error: {str(e)}, Retry error: {str(e_retry)}"


if __name__ == '__main__':
    # Test with a dummy file (requires actual audio file for meaningful results)
    print("Testing transcription with Google Cloud Storage upload...")
    
    if not os.getenv("GOOGLE_CLOUD_PROJECT"):
        print("Error: GOOGLE_CLOUD_PROJECT is not set. Please set it in .env or your environment.")
    else:
        # For testing, you would need an actual audio file
        # dummy_audio_path = "path/to/your/test/audio.mp3"
        # transcript = transcribe_audio(dummy_audio_path, "audio/mpeg")
        # print("\n--- Transcription Result ---")
        # print(transcript)
        # print("--------------------------")
        print("Please provide a real audio file path to test transcription.") 
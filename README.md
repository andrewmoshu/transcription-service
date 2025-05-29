# Meeting Analyzer Chatbot

This application allows you to upload an audio file of a meeting, and it will:
1.  Transcribe the audio.
2.  Generate meeting takeaways.
3.  Provide a summary of the meeting.
4.  Create meeting notes.
5.  Allow you to ask questions about the meeting content.

## Setup

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```

2.  **Create a virtual environment and activate it:**
    ```bash
    python -m venv venv
    # On Windows
    venv\Scripts\activate
    # On macOS/Linux
    source venv/bin/activate
    ```

3.  **Install the dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Set up authentication:**

    **Option A: Using Google AI API Key (Recommended for simplicity)**
    
    Create a `.env` file in the root of the project and add:
    ```env
    GOOGLE_API_KEY="your-google-ai-api-key"
    ```
    Get your API key from [Google AI Studio](https://makersuite.google.com/app/apikey).

    **Option B: Using Google Cloud Vertex AI (Enterprise/Production)**
    
    Create a `.env` file in the root of the project and add:
    ```env
    GOOGLE_CLOUD_PROJECT="YOUR_GOOGLE_CLOUD_PROJECT_ID"
    GOOGLE_CLOUD_LOCATION="your-google-cloud-location" # e.g., "us-central1" or "global"
    # Optional: Use a Service Account JSON key file
    # GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/service-account-key.json"
    ```

    **For Vertex AI setup, you'll also need:**
    - Enable the Vertex AI API and Cloud Storage API in your Google Cloud project
    - The application will automatically create a temporary Cloud Storage bucket for audio file uploads (required for Vertex AI)
    - Ensure your service account has permissions for both Vertex AI and Cloud Storage

    **Authentication Methods for Vertex AI:**

    *   **For local development:** Use Application Default Credentials (ADC) by running:
        ```bash
        gcloud auth application-default login
        ```

    *   **For production/CI/CD:** Use a Service Account JSON key file:
        1.  Create a service account and download its JSON key file from the Google Cloud Console (IAM & Admin > Service Accounts). Ensure the service account has appropriate permissions (e.g., Vertex AI User, Storage Admin).
        2.  Set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the absolute path of this JSON file in your `.env` file.

    Refer to the [Google Cloud Vertex AI documentation](https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash) for more details on setting up Vertex AI authentication and enabling necessary APIs.

5.  **Run the application:**
    ```bash
    streamlit run app.py
    ```

## Usage

1.  Open your browser and go to the URL provided by Streamlit (usually `http://localhost:8501`).

2.  Upload your audio file (supported formats: MP3, WAV, M4A, FLAC, AAC, OGG, OPUS, WEBM).

3.  Click "Process Meeting Audio" to start transcription and analysis.

4.  The application will display the transcription, takeaways, summary, and notes in separate tabs.

5.  Navigate to the "Chat about the Meeting" tab to ask questions about the uploaded meeting.

## Model Used
This application uses `gemini-2.5-flash` for all generative tasks. The transcription uses the Google Gemini API directly, while the LangChain integration uses `ChatGoogleGenerativeAI` for generating summaries, takeaways, notes, and chat responses. 
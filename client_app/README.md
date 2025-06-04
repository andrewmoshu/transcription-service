# Live Microphone Client

A Python client application that captures audio from your microphone and streams it to the live transcription server for real-time speech-to-text conversion.

## Features

- Real-time microphone audio capture
- WebSocket streaming to transcription server
- Command-line interface
- Device selection support
- Session management
- Real-time transcript display

## Requirements

- Python 3.7+
- Microphone access
- Active internet connection
- Live transcription server running on port 5001

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

**Note for Windows users**: If you encounter issues installing PyAudio, you may need to:
- Install Microsoft Visual C++ Build Tools, or
- Use conda: `conda install pyaudio`, or
- Install from wheel: `pip install pipwin && pipwin install pyaudio`

## Usage

### Basic Usage

Start live transcription with default microphone:
```bash
python live_mic_client.py
```

### List Audio Devices

To see available microphone devices:
```bash
python live_mic_client.py --list-devices
```

### Specify Audio Device

Use a specific microphone device:
```bash
python live_mic_client.py --device 1
```

### Connect to Different Server

Connect to a custom server:
```bash
python live_mic_client.py --server ws://your-server:5001
```

### Join Existing Session

Join an existing transcription session:
```bash
python live_mic_client.py --session YOUR_SESSION_ID
```

## Command Line Options

- `--server`: WebSocket server URL (default: ws://localhost:5001)
- `--session`: Existing session ID to join
- `--list-devices`: List available audio input devices
- `--device`: Audio device index to use (from --list-devices)

## How It Works

1. **Session Creation**: Creates a new transcription session on the server
2. **Audio Capture**: Captures audio from your microphone at 16kHz, mono
3. **Streaming**: Sends audio chunks to the server via WebSocket
4. **Real-time Display**: Shows transcription results as they arrive

## Audio Settings

- Sample Rate: 16,000 Hz
- Channels: 1 (Mono)
- Format: 16-bit PCM
- Chunk Size: 1024 samples

## Troubleshooting

### Microphone Not Working
- Check microphone permissions
- Try listing devices with `--list-devices`
- Specify a device with `--device INDEX`

### Connection Issues
- Ensure the live transcription server is running on port 5001
- Check firewall settings
- Verify server URL with `--server` option

### Audio Quality Issues
- Use a good quality microphone
- Minimize background noise
- Speak clearly and at normal volume
- Ensure stable internet connection

## Example Session

```bash
$ python live_mic_client.py

Starting Live Microphone Client...
==================================================
✓ Session created: abc123def-456...
✓ Transcription session started
✓ Connected to ws://localhost:5001
✓ Joined session: abc123def-456...
✓ Audio capture started (Sample Rate: 16000Hz, Channels: 1)

==================================================
🎤 LIVE TRANSCRIPTION ACTIVE
Press Ctrl+C to stop
==================================================

[14:30:15] Hello, this is a test of live transcription.
[14:30:18] The system is working correctly.
[14:30:22] This text appears in real-time as I speak.

^C
✓ Stopping by user request...

Cleaning up...
✓ Audio capture stopped
✓ Cleanup complete
```

## Integration

This client can be integrated with:
- Web applications (via the frontend interface)
- Other Python applications (import as module)
- Command-line workflows
- Automated transcription pipelines 
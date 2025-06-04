#!/usr/bin/env python3
"""
Live Microphone Client for Real-time Transcription
Captures audio from microphone and streams to backend server
"""

import asyncio
import websockets
import json
import base64
import argparse
import sys
import signal
import pyaudio
import time
from typing import Optional
import threading
import queue

class LiveMicClient:
    def __init__(self, server_url: str = "ws://localhost:5001", session_id: Optional[str] = None):
        self.server_url = server_url
        self.session_id = session_id
        self.websocket = None
        self.is_running = False
        self.audio_queue = queue.Queue()
        
        # Audio settings
        self.sample_rate = 16000
        self.channels = 1
        self.chunk_size = 1024
        self.audio_format = pyaudio.paInt16
        
        # PyAudio instance
        self.audio = pyaudio.PyAudio()
        self.stream = None
        
        # Threading
        self.audio_thread = None
        
    def list_audio_devices(self):
        """List available audio input devices"""
        print("\nAvailable audio input devices:")
        print("-" * 50)
        
        device_count = self.audio.get_device_count()
        for i in range(device_count):
            device_info = self.audio.get_device_info_by_index(i)
            if device_info['maxInputChannels'] > 0:  # Input device
                print(f"Device {i}: {device_info['name']}")
                print(f"  Channels: {device_info['maxInputChannels']}")
                print(f"  Sample Rate: {device_info['defaultSampleRate']}")
                print()
    
    def audio_callback(self, in_data, frame_count, time_info, status):
        """Callback for audio stream"""
        if self.is_running:
            self.audio_queue.put(in_data)
        return (None, pyaudio.paContinue)
    
    def start_audio_capture(self, device_index=None):
        """Start capturing audio from microphone"""
        try:
            self.stream = self.audio.open(
                format=self.audio_format,
                channels=self.channels,
                rate=self.sample_rate,
                input=True,
                input_device_index=device_index,
                frames_per_buffer=self.chunk_size,
                stream_callback=self.audio_callback
            )
            
            self.stream.start_stream()
            print(f"✓ Audio capture started (Sample Rate: {self.sample_rate}Hz, Channels: {self.channels})")
            return True
            
        except Exception as e:
            print(f"✗ Error starting audio capture: {e}")
            return False
    
    def stop_audio_capture(self):
        """Stop audio capture"""
        if self.stream:
            self.stream.stop_stream()
            self.stream.close()
            self.stream = None
            print("✓ Audio capture stopped")
    
    async def create_session(self):
        """Create a new transcription session"""
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.server_url.replace('ws://', 'http://')}/api/sessions") as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get('success'):
                            self.session_id = data.get('session_id')
                            print(f"✓ Session created: {self.session_id}")
                            return True
                    print(f"✗ Failed to create session: {await response.text()}")
                    return False
        except Exception as e:
            print(f"✗ Error creating session: {e}")
            return False
    
    async def start_session(self):
        """Start the transcription session"""
        try:
            import aiohttp
            async with aiohttp.ClientSession() as session:
                async with session.post(f"{self.server_url.replace('ws://', 'http://')}/api/sessions/{self.session_id}/start") as response:
                    if response.status == 200:
                        data = await response.json()
                        if data.get('success'):
                            print("✓ Transcription session started")
                            return True
                    print(f"✗ Failed to start session: {await response.text()}")
                    return False
        except Exception as e:
            print(f"✗ Error starting session: {e}")
            return False
    
    async def connect_websocket(self):
        """Connect to WebSocket server"""
        try:
            self.websocket = await websockets.connect(self.server_url)
            print(f"✓ Connected to {self.server_url}")
            
            # Join the session
            if self.session_id:
                await self.websocket.send(json.dumps({
                    "type": "join_session",
                    "session_id": self.session_id
                }))
                print(f"✓ Joined session: {self.session_id}")
            
            return True
            
        except Exception as e:
            print(f"✗ Failed to connect to WebSocket: {e}")
            return False
    
    async def send_audio_chunk(self, audio_data):
        """Send audio chunk to server"""
        if self.websocket and not self.websocket.closed:
            try:
                # Encode audio data as base64
                audio_b64 = base64.b64encode(audio_data).decode('utf-8')
                
                message = {
                    "type": "audio_chunk",
                    "session_id": self.session_id,
                    "audio_data": audio_b64
                }
                
                await self.websocket.send(json.dumps(message))
                
            except Exception as e:
                print(f"✗ Error sending audio: {e}")
    
    async def listen_for_messages(self):
        """Listen for messages from server"""
        try:
            async for message in self.websocket:
                try:
                    data = json.loads(message)
                    message_type = data.get('type', 'unknown')
                    
                    if message_type == 'transcript_update':
                        updates = data.get('updates', [])
                        for update in updates:
                            timestamp = update.get('timestamp', '')
                            text = update.get('text', '')
                            print(f"[{timestamp}] {text}")
                    
                    elif message_type == 'error':
                        error_msg = data.get('message', 'Unknown error')
                        print(f"✗ Server error: {error_msg}")
                    
                    elif message_type == 'connected':
                        print("✓ WebSocket connection confirmed")
                    
                except json.JSONDecodeError:
                    print(f"✗ Invalid JSON received: {message}")
                    
        except websockets.exceptions.ConnectionClosed:
            print("✗ WebSocket connection closed")
        except Exception as e:
            print(f"✗ Error listening for messages: {e}")
    
    async def audio_streaming_loop(self):
        """Main loop for streaming audio"""
        print("Starting audio streaming...")
        
        while self.is_running:
            try:
                # Get audio data from queue
                try:
                    audio_data = self.audio_queue.get(timeout=0.1)
                    await self.send_audio_chunk(audio_data)
                except queue.Empty:
                    continue
                    
            except Exception as e:
                print(f"✗ Error in audio streaming loop: {e}")
                break
    
    async def run(self, device_index=None):
        """Main run method"""
        print("Starting Live Microphone Client...")
        print("=" * 50)
        
        # Create session if not provided
        if not self.session_id:
            if not await self.create_session():
                return False
        
        # Start the session
        if not await self.start_session():
            return False
        
        # Connect to WebSocket
        if not await self.connect_websocket():
            return False
        
        # Start audio capture
        if not self.start_audio_capture(device_index):
            return False
        
        self.is_running = True
        
        print("\n" + "=" * 50)
        print("🎤 LIVE TRANSCRIPTION ACTIVE")
        print("Press Ctrl+C to stop")
        print("=" * 50)
        print()
        
        try:
            # Run both audio streaming and message listening concurrently
            await asyncio.gather(
                self.audio_streaming_loop(),
                self.listen_for_messages()
            )
        except KeyboardInterrupt:
            print("\n✓ Stopping by user request...")
        except Exception as e:
            print(f"✗ Runtime error: {e}")
        finally:
            await self.cleanup()
    
    async def cleanup(self):
        """Clean up resources"""
        print("\nCleaning up...")
        
        self.is_running = False
        
        # Stop audio capture
        self.stop_audio_capture()
        
        # Close WebSocket
        if self.websocket:
            await self.websocket.close()
        
        # Close PyAudio
        self.audio.terminate()
        
        print("✓ Cleanup complete")

def signal_handler(signum, frame):
    """Handle Ctrl+C gracefully"""
    print("\nReceived interrupt signal...")
    sys.exit(0)

async def main():
    parser = argparse.ArgumentParser(description="Live Microphone Client for Real-time Transcription")
    parser.add_argument("--server", default="ws://localhost:5001", help="WebSocket server URL")
    parser.add_argument("--session", help="Existing session ID to join")
    parser.add_argument("--list-devices", action="store_true", help="List available audio devices")
    parser.add_argument("--device", type=int, help="Audio device index to use")
    
    args = parser.parse_args()
    
    # Set up signal handler
    signal.signal(signal.SIGINT, signal_handler)
    
    client = LiveMicClient(args.server, args.session)
    
    if args.list_devices:
        client.list_audio_devices()
        return
    
    try:
        await client.run(args.device)
    except KeyboardInterrupt:
        print("\nExiting...")

if __name__ == "__main__":
    # Check dependencies
    try:
        import pyaudio
        import websockets
        import aiohttp
    except ImportError as e:
        print(f"Missing dependency: {e}")
        print("Please install required packages:")
        print("pip install pyaudio websockets aiohttp")
        sys.exit(1)
    
    asyncio.run(main()) 
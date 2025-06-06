# Audio System Improvements

## Overview
The live transcription system has been significantly upgraded to provide better audio capture capabilities and cross-platform compatibility for both Mac and Windows users.

## Key Improvements

### 1. Modern Audio Processing
- **Replaced deprecated ScriptProcessorNode** with modern **AudioWorkletNode**
- Improved performance and reduced audio latency
- Better handling of sample rate conversion (48kHz → 16kHz)
- Eliminated browser deprecation warnings

### 2. Enhanced System Audio Capture
- **Proper screen/window selection dialog** for system audio capture
- Clear user guidance for Mac and Windows users
- Graceful fallback to microphone-only if system audio fails
- Better error messages and permission handling

### 3. Audio Source Selection
- **Interactive audio source selection dialog** before recording starts
- Lists all available microphone devices with friendly names
- Choice between microphone-only or microphone + system audio
- Platform-specific guidance for enabling permissions

### 4. Improved User Experience
- **Real-time audio source display** in the status bar
- Visual feedback showing active audio sources
- Better error messages with specific troubleshooting tips
- Responsive design for mobile devices

## Platform-Specific Instructions

### Mac Users
- **System Audio**: Enable "System Preferences > Security & Privacy > Screen Recording" for your browser
- When prompted, select the screen, window, or browser tab you want to capture audio from
- Works best with Chrome, Safari, and Edge browsers

### Windows Users
- **System Audio**: Some browsers may require additional permissions
- Select the entire screen or specific application window when prompted
- Chrome and Edge provide the best compatibility

## Technical Details

### AudioWorklet Implementation
- Custom `audio-processor.js` handles real-time audio processing
- Efficient downsampling from native sample rate to 16kHz
- Reduced memory usage and improved performance
- Better audio quality with proper anti-aliasing

### System Audio Capture
- Uses `getDisplayMedia()` API with audio constraints
- Combines microphone and system audio streams using AudioContext mixer
- Proper cleanup of all audio resources on session end
- Fallback strategies for unsupported configurations

### Device Management
- Automatic discovery of available microphone devices
- Permission handling and device enumeration
- Friendly device names when available
- Graceful handling of device changes during recording

## Browser Compatibility

| Browser | Microphone | System Audio | Notes |
|---------|-----------|--------------|-------|
| Chrome  | ✅         | ✅           | Full support |
| Edge    | ✅         | ✅           | Full support |
| Safari  | ✅         | ⚠️           | Limited system audio |
| Firefox | ✅         | ❌           | No system audio support |

## Troubleshooting

### "System audio capture not available"
- Ensure browser supports `getDisplayMedia()` with audio
- Check browser permissions for screen recording
- Try selecting a different screen/window when prompted

### "No microphone devices available"
- Check browser microphone permissions
- Ensure microphone is not being used by another application
- Try refreshing the page and granting permissions again

### AudioWorklet errors
- Ensure the `assets/audio-processor.js` file is accessible
- Check browser console for specific error messages
- Some older browsers may not support AudioWorklet

## Future Improvements
- Advanced audio filtering and noise reduction
- Audio level meters and visual feedback
- Support for external audio interfaces
- Real-time audio enhancement options 
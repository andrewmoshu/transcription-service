class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.bufferSize = 4096;
    this.buffer = new Float32Array(this.bufferSize);
    this.bufferIndex = 0;
    this.targetSampleRate = 16000;
    this.sourceSampleRate = sampleRate; // This is provided by AudioWorkletGlobalScope
    this.downsampleRatio = this.sourceSampleRate / this.targetSampleRate;
    this.downsampleIndex = 0;
    
    console.log('AudioProcessor initialized:', {
      sourceSampleRate: this.sourceSampleRate,
      targetSampleRate: this.targetSampleRate,
      downsampleRatio: this.downsampleRatio
    });
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    
    if (input.length > 0 && input[0]) {
      const inputChannel = input[0];
      const outputChannel = output[0];
      
      for (let i = 0; i < inputChannel.length; i++) {
        // Downsample from source rate to 16kHz
        this.downsampleIndex++;
        
        if (this.downsampleIndex >= this.downsampleRatio) {
          this.buffer[this.bufferIndex] = inputChannel[i];
          this.bufferIndex++;
          this.downsampleIndex = 0;
          
          // When buffer is full, send it to the main thread
          if (this.bufferIndex >= this.bufferSize) {
            this.port.postMessage({
              type: 'audioData',
              data: new Float32Array(this.buffer)
            });
            this.bufferIndex = 0;
          }
        }
        
        // Pass through audio to output (if output channel exists)
        if (outputChannel && outputChannel[i] !== undefined) {
          outputChannel[i] = inputChannel[i];
        }
      }
    }
    
    return true;
  }
}

registerProcessor('audio-processor', AudioProcessor); 
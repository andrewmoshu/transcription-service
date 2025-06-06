const path = require('path');

module.exports = {
  module: {
    rules: [
      {
        test: /\.worklet\.js$/,
        use: {
          loader: 'audio-worklet-loader',
          options: {
            inline: 'no-fallback'
          }
        }
      }
    ]
  }
}; 
const { Client } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const OPEN_KEY = ""
const OpenAI = require('openai');
const FormData = require('form-data');
const axios = require('axios'); // For making API calls
const fs = require('fs');

const client = new Client();

client.on('qr', (qr) => {
  console.log('QR RECEIVED', qr);
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('Client is ready!');
});

let userMessageHistories = {};

async function transcribeAudioWithOpenAI(audio_base64) {
  try {
    const audioBuffer = Buffer.from(audio_base64, 'base64');
    
    fs.writeFileSync('temp_audio.mp3', audioBuffer);

    const formData = new FormData();
    formData.append('file', fs.createReadStream('temp_audio.mp3'));
    formData.append('model', 'whisper-1');

    console.log('Sending audio -> ', audio_base64)
    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${OPEN_KEY}`,
          ...formData.getHeaders()
        },
      }
    );
    console.log('Transcription response -> ', JSON.stringify(response.data))
    fs.unlinkSync('temp_audio.mp3');
    return response.data.text; 
  } catch (error) {
    console.error('Error during transcription:', error);
    return null;
  }
}

var user_message_prompt = (msg) => {
  return {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": `${msg}\n`
      }
    ]
  };
};

var user_image_prompt = async (msg_msg, msg) => {
  const media = await msg.downloadMedia();

  return {
    "role": "user",
    "content": [
      {
        "type": "image_url",
        "image_url": {
          "url": `data:image/png;base64,${media.data}`,
          "detail": "high"
        }
      },
      {
        "type": "text",
        "text": `${msg_msg}\n`
      }
    ]
  };
};

var user_audio_prompt = (msg, transcribed_text) => {
  return {
    "role": "user",
    "content": [
      {
        "type": "text",
        "text": transcribed_text
      }
    ]
  };
};

async function defineMessageType(msg) {
  let message;

  try {
    if (msg.hasMedia && msg.type === 'image') {
      const media = await msg.downloadMedia();
      if (media) {
        message = await user_image_prompt(msg.body, msg);
      } else {
        message = user_message_prompt("Sorry, I couldn't retrieve the image.");
      }
    } else if (msg.hasMedia && msg.type === 'ptt') {
      const media = await msg.downloadMedia();
      if (media) {
        const audio_base64 = media.data; // Get base64 encoded audio data
        console.log("Downloaded audio -> ", audio_base64);

        const transcribedText = await transcribeAudioWithOpenAI(audio_base64);
        console.log("Transcribed audio -> ", transcribedText);

        if (transcribedText) {
          message = user_audio_prompt(msg.body, transcribedText);
        } else {
          message = user_message_prompt("Sorry, I couldn't transcribe the audio.");
        }
      } else {
        message = user_message_prompt("Sorry, I couldn't retrieve the audio.");
      }
    } else {
      message = user_message_prompt(msg.body);
    }
  } catch (error) {
    console.error('Error processing media:', error);
    message = user_message_prompt("An error occurred while processing your message.");
  }

  return message;
}

client.on('message', async (msg) => {
  const userId = msg.from;
  if (!userMessageHistories[userId]) {
    userMessageHistories[userId] = [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": "You will act as Alfred from now on, he is a friendly short-answer assistant, he uses emojis and writes easy-to-read text. He also responds to friendly questions such as hi how are you etc.\n"
          }
        ]
      }
    ];
  }

  const message = await defineMessageType(msg);
  userMessageHistories[userId].push(message);
  console.log("Msg -> ", msg)
  console.log("Using this at the end -> ", JSON.stringify(userMessageHistories[userId]));

  if (msg.type == "ptt" || msg.body.toLowerCase().includes('alfred') || msg.body.toLowerCase().includes('álfrede') || msg.body.toLowerCase().includes('alfrede')) {

    const openai = new OpenAI({
      apiKey: OPEN_KEY,
    });
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: userMessageHistories[userId],
      temperature: 1,
      max_tokens: 256,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    console.log("OpenAI Response ->", JSON.stringify(response, null, 2));
    msg.reply(response.choices[0].message.content);
  }
});

client.initialize();

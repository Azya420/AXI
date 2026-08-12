require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const { PREVIEW_STYLE_PROMPT } = require('./src/prompt');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://axi3d.pl,https://www.axi3d.pl')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024; // 8MB
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// gpt-image-1 cost scales heavily with quality: low is roughly an order of
// magnitude cheaper than high. Default to the cheap tier since this is a
// draft/preview feature, not final art - override via env var once the
// prompt is dialed in and quality actually matters.
const IMAGE_QUALITY = process.env.IMAGE_QUALITY || 'low'; // low | medium | high | auto
const IMAGE_SIZE = process.env.IMAGE_SIZE || '1024x1024';

const app = express();
app.set('trust proxy', 1);

app.use(
  cors({
    origin(origin, callback) {
      // Allow no-Origin requests (curl, server-to-server health checks) and any allow-listed origin.
      if (!origin || ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('Not allowed by CORS'));
    },
  })
);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Nieobsługiwany format pliku. Wyślij JPG, PNG lub WEBP.'));
    }
    cb(null, true);
  },
});

// Generous but cost-protective: image generations cost real money per call.
const previewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1h
  max: Number(process.env.PREVIEW_RATE_LIMIT || 15),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Zbyt wiele prób. Spróbuj ponownie za jakiś czas.' },
});

let openaiClient = null;
function getOpenAIClient() {
  if (!OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: OPENAI_API_KEY });
  return openaiClient;
}

app.get('/health', (req, res) => {
  res.json({ ok: true, configured: Boolean(OPENAI_API_KEY) });
});

app.get('/', (req, res) => {
  res.json({ service: 'axi-preview-generator', status: 'running' });
});

app.post('/api/preview', previewLimiter, upload.single('photo'), async (req, res) => {
  const client = getOpenAIClient();
  if (!client) {
    return res.status(500).json({
      error: 'Serwis nie jest jeszcze skonfigurowany (brak OPENAI_API_KEY na serwerze).',
    });
  }
  if (!req.file) {
    return res.status(400).json({ error: 'Nie przesłano zdjęcia (pole "photo").' });
  }

  try {
    const inputFile = await toFile(req.file.buffer, req.file.originalname || 'photo.png', {
      type: req.file.mimetype,
    });

    const result = await client.images.edit({
      model: 'gpt-image-1',
      image: inputFile,
      prompt: PREVIEW_STYLE_PROMPT,
      size: IMAGE_SIZE,
      quality: IMAGE_QUALITY,
    });

    const b64 = result.data && result.data[0] && result.data[0].b64_json;
    if (!b64) {
      throw new Error('Brak danych obrazu w odpowiedzi OpenAI.');
    }

    res.json({ image: `data:image/png;base64,${b64}` });
  } catch (err) {
    console.error('Preview generation failed:', err);
    res.status(502).json({
      error: 'Nie udało się wygenerować podglądu. Spróbuj ponownie za chwilę.',
    });
  }
});

// Multer / validation errors land here.
app.use((err, req, res, next) => {
  if (err) {
    return res.status(400).json({ error: err.message || 'Błąd żądania.' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`axi-preview-generator listening on port ${PORT}`);
  if (!OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY is not set - /api/preview will return 500 until it is configured.');
  }
});

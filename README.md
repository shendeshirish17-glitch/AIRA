[readme_md.md](https://github.com/user-attachments/files/34617534/readme_md.md)
# 📻 AIRa: The Indic AI Radio Jockey Platform

> **Two Voices, One Wave.** Bringing back the nostalgic magic of transistor radio, powered by modern Indic AI.

AIRa bridges classic radio culture with real-time generative AI. Built for regional and code-mixed Indian languages (Hinglish, Tamil, Marathi, and more), AIRa introduces dynamic AI Radio Jockeys who chat naturally, spin tracks, share live news, and let you interrupt whenever you want to talk.

---

## 🎧 What Makes AIRa Special?

* **Authentic Regional Vibe:** Tune into virtual frequencies featuring distinct RJ personalities (*RJ Kabir*, *RJ Aarya*, *RJ Kavya*) speaking native dialects and code-mixed Indian slang.
* **Seamless Barge-In (Interruption):** Don't wait for the RJ to finish—speak mid-sentence, and AIRa instantly cuts its audio to listen to what you need.
* **Smart Audio Ducking:** Just like a real radio station, background music dips to a whisper when the RJ speaks and swells right back up when the song takes over.
* **On-Demand Regional News:** Get quick, localized headlines summarized by AI and read in your preferred dialect on demand.
* **Retro OLED Aesthetics:** Designed with a pitch-black interface, analog frequency tuner, and a responsive HTML5 visualizer wave that dances to the voice and music.

---

## 🛠️ How It Works (Tech & Architecture)

### 🎙️ Voice & Intelligence Pipeline
AIRa is powered by **Gnani.ai**'s specialized voice stack designed for Indian speech:
* **Prisma v2.5 (ASR):** Accurately transcribes noisy, fast, and multilingual code-mixed voice inputs.
* **Evon v3.3 (LLM / vLLM):** Powers context-aware RJ banter, extracting user mood, song requests, and news intents.
* **Timbre v2.5 (TTS):** Generates warm, low-latency synthetic voices with authentic regional accents and human-like intonation.

### 💻 Platform Engine
* **Frontend:** React + Vite, Tailwind CSS, HTML5 Canvas (Audio Waveform), Web Audio API.
* **Backend:** Node.js / Supabase Edge Functions handling cloud-to-device API handshakes and secret isolation.
* **Media Sync:** YouTube Data & IFrame APIs for dynamic music search and headless audio playback.

---

## 📻 Station Guide

| Frequency | RJ Persona | Vibe & Genre Focus | Primary Language |
| :--- | :--- | :--- | :--- |
| **98.3 MHz** | RJ Kabir | Bollywood Hits & Witty Banter | Hinglish (`hi-IN` / `hi-en`) |
| **104.2 MHz** | RJ Aarya | Regional Hits & Daily Bulletins | Marathi (`mr-IN`) |
| **92.7 MHz** | RJ Kavya | South Indian Indie & Trending Beats | Tamil (`ta-IN`) |

---


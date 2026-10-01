# My First Chatbot

A beginner-friendly chatbot built with Python and Flask. It runs locally in a browser and replies to a small set of predefined messages.

## Project Structure

```text
AI-CHATBOAT/
├── app.py                 # Flask routes and chatbot reply rules
├── requirements.txt       # Python dependencies
├── templates/
│   └── index.html         # Chat page and browser-side JavaScript
└── static/
    └── style.css          # Chat page styles
```

## Run Locally

Python 3.10 or newer is recommended.

```bash
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
python -m pip install -r requirements.txt
python app.py
```

Open http://127.0.0.1:5000 in your browser. Stop the server with Ctrl+C.

## Chatbot Replies

- `hello` -> Hi! How can I help you?
- `how are you` -> I am fine. Thanks for asking.
- `what is your name` -> I am a beginner chatbot.
- `bye` -> Goodbye! Have a nice day.
- Any other message -> Sorry, I am still learning.

Matching ignores letter case and repeated whitespace. This is a rule-based learning project, not an AI model. Chat messages are displayed in the current page and are not saved after it closes.

## How It Works

1. Flask serves `templates/index.html` when the browser visits `/`.
2. JavaScript sends each message to Flask's `/chat` route as JSON.
3. Python normalizes the text, looks up a predefined response, and returns JSON.
4. JavaScript adds the user's message and reply to the chat area without reloading the page.

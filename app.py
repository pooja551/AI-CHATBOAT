from flask import Flask, jsonify, render_template, request

# Create the Flask application that serves the page and chat endpoint.
app = Flask(__name__)

# Match normalized user messages to the chatbot's predefined replies.
RESPONSES = {
    "hello": "Hi! How can I help you?",
    "how are you": "I am fine. Thanks for asking.",
    "what is your name": "I am a beginner chatbot.",
    "bye": "Goodbye! Have a nice day.",
}
FALLBACK_RESPONSE = "Sorry, I am still learning."
MAX_MESSAGE_LENGTH = 500


# Show the chat page when the visitor opens the site.
@app.get("/")
def index():
    return render_template("index.html")


# Receive a message from the browser and return the matching response as JSON.
@app.post("/chat")
def chat():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(error="Send your message as JSON."), 400

    message = data.get("message", "")
    if not isinstance(message, str):
        return jsonify(error="Your message must be text."), 400

    # Ignore extra whitespace and letter case for easy matching.
    normalized_message = " ".join(message.split()).casefold()
    if not normalized_message:
        return jsonify(error="Please type a message first."), 400
    if len(normalized_message) > MAX_MESSAGE_LENGTH:
        return jsonify(error="Please keep messages under 500 characters."), 400

    reply = RESPONSES.get(normalized_message, FALLBACK_RESPONSE)
    return jsonify(reply=reply)


# Run on localhost when started with: python app.py
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)

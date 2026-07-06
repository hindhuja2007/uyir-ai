import os
import requests
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv()  # reads variables from .env into the environment

app = Flask(__name__)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/gemini", methods=["POST"])
def gemini_proxy():
    """
    Frontend never sees the API key. It POSTs {prompt, filePart} here,
    we attach the key server-side and call Gemini, then return only
    the generated text (or a clean error message) back to the browser.
    """
    if not GEMINI_API_KEY:
        return jsonify({"error": "Server is missing GEMINI_API_KEY. Add it to your .env file and restart."}), 500

    body = request.get_json(force=True, silent=True) or {}
    prompt_text = body.get("prompt", "")
    file_part = body.get("filePart")  # optional: {mimeType, data}

    if not prompt_text and not file_part:
        return jsonify({"error": "No prompt or file provided."}), 400

    parts = [{"text": prompt_text}]
    if file_part and file_part.get("mimeType") and file_part.get("data"):
        parts.append({
            "inlineData": {
                "mimeType": file_part["mimeType"],
                "data": file_part["data"],
            }
        })

    payload = {"contents": [{"parts": parts}]}

    try:
        resp = requests.post(
            GEMINI_URL,
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=60,
        )
        result = resp.json()
    except requests.RequestException as e:
        return jsonify({"error": f"Network/API error: {str(e)}"}), 502

    if "error" in result:
        message = result["error"].get("message", "Unknown Gemini error")
        return jsonify({"error": f"Gemini error: {message}"}), 400

    try:
        text = result["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, TypeError):
        text = "No response received."

    return jsonify({"text": text})


if __name__ == "__main__":
    # debug=True is fine for local dev; turn off before any real deployment
    app.run(debug=True)

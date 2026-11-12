import json
import os
import time
from datetime import date
from typing import Literal

import groq
import requests
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from groq import Groq
from pydantic import BaseModel, Field

load_dotenv()
MODEL = os.getenv("MODEL", "openai/gpt-oss-120b")
NEWS_API_KEY = os.getenv("NEWS_API_KEY")
MAX_STEPS = 5

client = Groq(api_key=os.getenv("GROQ_API_KEY"))
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class NewsError(Exception):
    pass


# ---------- GNews helpers ----------

def _gnews(endpoint: str, params: dict) -> list[dict]:
    """Call a GNews endpoint ('search' or 'top-headlines') and return cleaned articles."""
    try:
        for attempt in range(2):
            resp = requests.get(
                f"https://gnews.io/api/v4/{endpoint}",
                params={**params, "lang": "en", "max": 5, "apikey": NEWS_API_KEY},
                timeout=10,
            )
            # GNews limits requests per second; wait once and retry
            if resp.status_code != 429 or attempt == 1:
                break
            time.sleep(1)
        data = resp.json()
    except (requests.RequestException, ValueError) as e:
        raise NewsError(f"Could not reach the news service: {e}")

    articles = data.get("articles", []) if isinstance(data, dict) else []
    errors = data.get("errors") if isinstance(data, dict) else None
    print(
        f"GNEWS {endpoint} {params} -> status {resp.status_code}, "
        f"articles {len(articles)}, errors {errors}"
    )

    if resp.status_code != 200:
        raise NewsError(f"News service error ({resp.status_code}): {errors or resp.text}")

    return [
        {
            "title": a.get("title"),
            "description": a.get("description"),
            "source": (a.get("source") or {}).get("name"),
            "publishedAt": a.get("publishedAt"),
            "url": a.get("url"),
        }
        for a in articles
    ]


def search_news(query: str) -> list[dict]:
    """Search a specific topic. Retries with a shorter query if nothing is found."""
    query = query.strip()
    if not query:
        return []
    articles = _gnews("search", {"q": query, "sortby": "publishedAt"})
    words = query.split()
    if not articles and len(words) > 1:
        short = " ".join(words[:2])
        articles = _gnews("search", {"q": short, "sortby": "publishedAt"})
    if not articles and len(words) > 2:
        articles = _gnews("search", {"q": words[0], "sortby": "publishedAt"})
    return articles


def top_headlines(category: str = "general", country: str = "in") -> list[dict]:
    """Today's top headlines for a category and country."""
    return _gnews("top-headlines", {"category": category, "country": country or "in"})


# ---------- Tools for the model ----------

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_news",
            "description": (
                "Search news about a SPECIFIC topic, company or person. "
                "The query must be 1-3 keywords only, never a full sentence. "
                "Good: 'NVIDIA', 'artificial intelligence', 'Sensex'. "
                "Bad: 'what is happening in AI this week'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "1-3 keywords"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "top_headlines",
            "description": (
                "Get today's top headlines. Use for broad questions like "
                "'today's news', 'latest in tech', 'what's happening in business'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": [
                            "general", "world", "nation", "business", "technology",
                            "entertainment", "sports", "science", "health",
                        ],
                    },
                    "country": {
                        "type": "string",
                        "description": "2-letter country code, e.g. 'in', 'us'. Default 'in'.",
                    },
                },
                "required": ["category"],
            },
        },
    },
]


def run_tool(name: str, args: dict) -> list[dict]:
    if name == "top_headlines":
        return top_headlines(args.get("category", "general"), args.get("country", "in"))
    if name == "search_news":
        return search_news(args.get("query", ""))
    raise NewsError(f"Unknown tool: {name}")


def system_prompt() -> str:
    return (
        f"You are a helpful assistant. Today's date is {date.today().isoformat()}.\n"
        "- For news or current-events questions, use the tools: top_headlines for broad "
        "questions (today's news, latest in a field), search_news for a specific topic, "
        "company or person. Answer ONLY from the articles returned. Cite sources inline by "
        "name, e.g. (Reuters). If a search finds nothing, try the other tool or a simpler "
        "keyword before saying no news was found.\n"
        "- For general questions, answer directly without calling any tool, concisely."
    )


# ---------- API ----------

class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AskBody(BaseModel):
    messages: list[Message] = Field(min_length=1)


def error(status: int, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": message})


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/ask")
def ask(body: AskBody):
    messages = [{"role": "system", "content": system_prompt()}]
    messages += [m.model_dump() for m in body.messages]
    sources: dict[str, dict] = {}

    try:
        for step in range(MAX_STEPS):
            # On the last step, force a final answer instead of another tool call
            last = step == MAX_STEPS - 1
            res = client.chat.completions.create(
                model=MODEL,
                messages=messages,
                tools=TOOLS,
                tool_choice="none" if last else "auto",
            )
            msg = res.choices[0].message
            if not msg.tool_calls:
                return {"answer": msg.content or "", "sources": list(sources.values())}

            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": c.id,
                        "type": "function",
                        "function": {"name": c.function.name, "arguments": c.function.arguments},
                    }
                    for c in msg.tool_calls
                ],
            })

            for call in msg.tool_calls:
                try:
                    args = json.loads(call.function.arguments or "{}")
                    print(f"TOOL CALL: {call.function.name} {args}")
                    articles = run_tool(call.function.name, args)
                    for a in articles:
                        if a["url"]:
                            sources[a["url"]] = {
                                k: a[k] for k in ("title", "source", "url", "publishedAt")
                            }
                    result = {"articles": articles}
                except NewsError as e:
                    result = {"error": str(e)}
                except json.JSONDecodeError:
                    result = {"error": "Invalid tool arguments"}
                messages.append({
                    "role": "tool",
                    "tool_call_id": call.id,
                    "content": json.dumps(result),
                })
    except groq.APIConnectionError:
        return error(502, "Could not reach the language model service.")
    except groq.RateLimitError:
        return error(429, "The language model is rate limited. Please try again shortly.")
    except groq.APIStatusError as e:
        return error(502, f"Language model error ({e.status_code}): {e.message}")

    return error(500, "The model did not produce an answer.")



    """Simple version without tool calling: fetch news for a topic, then answer."""
    try:
        articles = search_news(body.get("topic", ""))
    except NewsError as e:
        return error(502, str(e))

    headlines = "\n".join(
        f"- {a['title']} ({a['source']}, {(a['publishedAt'] or '')[:10]}): {a['description']}"
        for a in articles
    )
    try:
        res = client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": "Answer only using these news articles. "
                               "If the answer isn't there, say you don't know.\n\n" + headlines,
                },
                {"role": "user", "content": body.get("question", "")},
            ],
        )
    except groq.APIError as e:
        return error(502, f"Language model error: {e}")
    return {"answer": res.choices[0].message.content, "articles": articles}
"""Minimal public Python dock for Recipe 0. Use only with public/test candidates.

This standard-library example demonstrates the wire boundary. The maintained
Node adapter carries the complete access, size and timeout protections.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os

PROBE = {"solverapi_probe": "registration_preflight"}
MAX_BODY_BYTES = 1_048_576


def js_string_length(value):
    """Match JavaScript string length when reporting the sample quality score."""
    return len(value.encode("utf-16-le", "surrogatepass")) // 2


def normalize_candidate(candidate):
    """Use the same model-text boundary as the maintained Node adapter."""
    if not isinstance(candidate, str):
        return candidate, True
    trimmed = candidate.strip()
    if trimmed.startswith("{") or trimmed.startswith("["):
        try:
            return json.loads(trimmed), True
        except (json.JSONDecodeError, RecursionError):
            return None, False
    return {"summary": candidate}, True


def verdict(candidate):
    candidate, valid = normalize_candidate(candidate)
    if not valid:
        return {"is_correct": False, "quality_score": 0}
    if candidate == PROBE or contains_probe_marker(candidate):
        return {"is_correct": False, "quality_score": 0}
    if candidate is None:
        text = ""
    elif isinstance(candidate, dict) and isinstance(candidate.get("summary"), str):
        text = candidate["summary"]
    else:
        text = json.dumps(candidate, ensure_ascii=False, separators=(",", ":"))
    return {
        "is_correct": bool(text.strip()),
        "quality_score": min(1, js_string_length(text) / 200),
        "anchor_results": {"non_empty_output": bool(text.strip())},
    }


def contains_probe_marker(value):
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, dict):
            if "solverapi_probe" in current:
                return True
            pending.extend(current.values())
        elif isinstance(current, list):
            pending.extend(current)
    return False


class Dock(BaseHTTPRequestHandler):
    def read_body(self):
        if self.headers.get("transfer-encoding", "").lower() == "chunked":
            parts = []
            remaining = MAX_BODY_BYTES
            while True:
                chunk_header = self.rfile.readline(128)
                if not chunk_header.endswith(b"\r\n"):
                    raise ValueError("invalid_chunk_size")
                size = int(chunk_header.split(b";", 1)[0].strip(), 16)
                if size < 0:
                    raise ValueError("invalid_chunk_size")
                if size == 0:
                    if self.rfile.readline(128) != b"\r\n":
                        raise ValueError("invalid_chunk_ending")
                    break
                if size > remaining:
                    raise ValueError("request_too_large")
                parts.append(self.rfile.read(size))
                if self.rfile.read(2) != b"\r\n":
                    raise ValueError("invalid_chunk_ending")
                remaining -= size
            return b"".join(parts)
        length = int(self.headers.get("content-length", "0"))
        if length < 0:
            raise ValueError("invalid_content_length")
        if length > MAX_BODY_BYTES:
            raise ValueError("request_too_large")
        return self.rfile.read(length)

    def do_POST(self):
        try:
            body = json.loads(self.read_body())
            if set(body) != {"candidate"}:
                raise ValueError("candidate_required")
            encoded = json.dumps(verdict(body["candidate"])).encode()
            self.send_response(200)
        except RecursionError:
            encoded = b'{"error":"invalid_request"}'
            self.send_response(400)
        except RuntimeError:
            encoded = b'{"error":"check_failed"}'
            self.send_response(500)
        except (ValueError, TypeError, json.JSONDecodeError):
            encoded = b'{"error":"invalid_request"}'
            self.send_response(400)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format, *_args):
        return


ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8080"))), Dock).serve_forever()

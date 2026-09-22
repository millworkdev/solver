"""Minimal public Python dock for Recipe 0. Use only with public/test candidates.

This standard-library example demonstrates the wire boundary. The maintained
Node adapter carries the complete access, size and timeout protections.
"""

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os

PROBE = {"solverapi_probe": "registration_preflight"}


def verdict(candidate):
    if candidate == PROBE or contains_probe_marker(candidate):
        return {"is_correct": False, "quality_score": 0}
    if isinstance(candidate, dict) and candidate.get("simulate") == "technical_failure":
        raise RuntimeError("labelled Recipe 0 fixture: check unavailable")
    text = candidate if isinstance(candidate, str) else (
        candidate.get("summary", "") if isinstance(candidate, dict) else json.dumps(candidate, sort_keys=True)
    )
    return {
        "is_correct": bool(text.strip()),
        "quality_score": min(1, len(text) / 200),
        "anchor_results": {"non_empty_output": bool(text.strip())},
    }


def contains_probe_marker(value):
    if isinstance(value, dict):
        return "solverapi_probe" in value or any(contains_probe_marker(item) for item in value.values())
    if isinstance(value, list):
        return any(contains_probe_marker(item) for item in value)
    return False


class Dock(BaseHTTPRequestHandler):
    def read_body(self):
        if self.headers.get("transfer-encoding", "").lower() == "chunked":
            parts = []
            while True:
                size = int(self.rfile.readline().split(b";", 1)[0].strip(), 16)
                if size == 0:
                    self.rfile.readline()
                    break
                parts.append(self.rfile.read(size))
                self.rfile.read(2)
                if sum(map(len, parts)) > 1_048_576:
                    raise ValueError("request_too_large")
            return b"".join(parts)
        length = int(self.headers.get("content-length", "0"))
        if length > 1_048_576:
            raise ValueError("request_too_large")
        return self.rfile.read(length)

    def do_POST(self):
        try:
            body = json.loads(self.read_body())
            if set(body) != {"candidate"}:
                raise ValueError("candidate_required")
            encoded = json.dumps(verdict(body["candidate"])).encode()
            self.send_response(200)
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

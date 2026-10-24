"""Run from the repository root: python3 -m unittest discover -s backend/tests."""

import unittest
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routes.sessions import get_session_store, router
from backend.stores.sessions import SessionStore


class SessionApiTests(unittest.TestCase):
    def setUp(self):
        app = FastAPI()
        store = SessionStore()
        app.dependency_overrides[get_session_store] = lambda: store
        app.include_router(router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)
        self.payload = {"speaker": "Alex", "mode": "practice", "topic": "Robotics"}

    def create_session(self, **overrides):
        response = self.client.post("/sessions", json=self.payload | overrides)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_create_returns_input_and_unique_uuid(self):
        first = self.create_session()
        second = self.create_session()
        self.assertEqual(UUID(first["session_id"]).version, 4)
        self.assertNotEqual(first["session_id"], second["session_id"])
        self.assertEqual({k: first[k] for k in self.payload}, self.payload)

    def test_get_returns_stored_session(self):
        session = self.create_session()
        response = self.client.get(f"/sessions/{session['session_id']}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), session)

    def test_missing_session_returns_404(self):
        response = self.client.get(f"/sessions/{uuid4()}")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"detail": "Session not found"})

    def test_history_filters_by_speaker(self):
        first = self.create_session()
        self.create_session(speaker="Sam")
        second = self.create_session(topic="Space")
        response = self.client.get("/history/Alex")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [first, second])

    def test_unknown_speaker_has_empty_history(self):
        response = self.client.get("/history/Unknown")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_invalid_inputs_return_422(self):
        for field in self.payload:
            for value in (None, "", "   ", 123):
                with self.subTest(field=field, value=value):
                    response = self.client.post(
                        "/sessions", json=self.payload | {field: value}
                    )
                    self.assertEqual(response.status_code, 422)
            with self.subTest(missing=field):
                payload = {k: v for k, v in self.payload.items() if k != field}
                self.assertEqual(self.client.post("/sessions", json=payload).status_code, 422)
        self.assertEqual(self.client.get("/sessions/invalid-uuid").status_code, 422)

    def test_surrounding_whitespace_is_trimmed(self):
        session = self.create_session(speaker=" Alex ")
        self.assertEqual(session["speaker"], "Alex")
        self.assertEqual(self.client.get("/history/Alex").json(), [session])


if __name__ == "__main__":
    unittest.main()

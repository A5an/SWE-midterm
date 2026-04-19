# UI Recording Note

Video link: `https://youtu.be/BOvBJnDDCa8`

Recorded proof should show:

1. `#auth/register` in the web app.
2. Successful registration against the FastAPI backend.
3. Automatic navigation to `#auth/workspace`.
4. Protected `/v1/me` profile loading.
5. Browser refresh on `#auth/workspace`.
6. Persisted session restore without re-entering credentials.
7. Sign-out or anonymous protected-route block behavior.

Optional extra proof:

- Short access-token TTL followed by graceful refresh or clean fallback to sign-in.

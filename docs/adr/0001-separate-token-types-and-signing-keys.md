# Separate token types and signing keys

Access and refresh JWTs use independent signing keys and explicit `typ` claims. Access authentication also checks an active, unexpired database session. This prevents a refresh token from being replayed as a bearer token and makes the token class visible in code and logs. Startup rejects short or identical signing secrets.

**Status:** Accepted

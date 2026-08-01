# Security policy

ANM Player is a single-user application intended to run on one computer. Its default Docker and native launchers bind the web interface to `127.0.0.1`. It is not a multi-user service and does not provide internet-facing account authentication.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature on the repository's **Security** tab. Include the affected version, a minimal reproduction, and the impact you observed. Do not open a public issue for an unpatched vulnerability or include real access tokens, media, databases, or local paths in a report.

The maintainers will acknowledge a complete report when it is reviewed and will coordinate disclosure after a fix is available. There is currently no paid bug-bounty program.

## Deployment model

Anyone who can reach ANM Player's web service has operator-level control through the trusted same-origin proxy. Keep the default loopback binding. If remote access is required, put ANM Player behind a separately authenticated reverse proxy or a private VPN and restrict network access to trusted users.

Provider credentials, an ANM Player API token, databases, downloads, storage state, and local media must never be committed to the repository. Rotate a token immediately if it is exposed.

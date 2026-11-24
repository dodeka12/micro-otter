# Git Commit Signing with GPG (Windows)

This guide walks through generating/importing a GPG key and configuring Git to sign commits and tags on Windows. Use the repo's virtualenv if you prefer, but Git + GPG run independently of Python.

## 1) Install GPG

- Recommended: `winget install GnuPG.GnuPG` (or install Gpg4win from https://gpg4win.org/).
- After installation, ensure `gpg --version` works in a new terminal (PATH updated).

## 2) Create or import a key

- Create a new key: `gpg --full-generate-key` (choose RSA 4096 or Ed25519 if offered, set your name/email, choose a passphrase).
- List keys to copy the long key ID: `gpg --list-secret-keys --keyid-format=long` (look for the hex after `sec .../`).
- If you already have a key, import it: `gpg --import <path-to-key.asc>`.

## 3) Configure Git to sign

Replace `KEYID` with your long hex key ID (e.g., `ABCDEF1234567890`).

```bash
git config --global user.signingkey KEYID
git config --global commit.gpgsign true    # sign all commits
# Optional: also sign tags
git config --global tag.gpgSign true
```

If your install uses a non-default binary, set it explicitly:

```bash
git config --global gpg.program gpg    # or gpg2 if that is your binary name
```

On PowerShell, you can grab the full path to `gpg` and set Git in one go:

```powershell
git config --global gpg.program (Get-Command gpg).Source
```

## 4) GitHub trust (optional but recommended)

- Export your public key: `gpg --armor --export KEYID`
- Copy the output into GitHub: Settings -> SSH and GPG keys -> New GPG key.

## 5) VS Code tips

- If you keep `commit.gpgsign` off globally, enable per-editor signing: set `"git.enableCommitSigning": true` in VS Code settings.
- If VS Code cannot find GPG, point Git explicitly via `git config --global gpg.program gpg` (or `gpg2`).
- When prompted by pinentry, enter your key passphrase; use the same pinentry program that ships with Gpg4win.

## 6) Configure GPG agent password caching (optional)

By default, GPG prompts for your passphrase frequently. To cache it for 8 hours:

1. Create or edit `%APPDATA%\gnupg\gpg-agent.conf`:

    ```powershell
    $agentConf = "$env:APPDATA\gnupg\gpg-agent.conf"
    @"
    # Cache passphrase for 8 hours (28800 seconds)
    default-cache-ttl 28800
    max-cache-ttl 28800
    "@ | Out-File -FilePath $agentConf -Encoding utf8
    ```

2. Reload the agent to apply changes:
    ```bash
    gpgconf --reload gpg-agent
    ```

Now you'll only need to enter your passphrase once every 8 hours (or after a reboot).

## 7) Troubleshooting

- Pinentry does not appear: reinstall Gpg4win and ensure `gpg-agent` is running (usually automatic). On a fresh shell, run `gpgconf --launch gpg-agent`.
- VS Code keeps failing to sign: verify the configured key matches `git config --show-origin --get user.signingkey` and that `gpg --list-secret-keys` shows it.
- Wrong key used: re-run `git config --global user.signingkey KEYID` with the correct long ID.

## 8) Verify signatures

- After a commit, run `git log --show-signature -1` to confirm it shows "Good signature".

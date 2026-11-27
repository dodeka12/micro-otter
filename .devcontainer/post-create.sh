#!/usr/bin/env bash
set -euo pipefail

# The workspace and any repository bind-mounted beside it are owned by the host user, while the
# container runs as root. Git refuses to treat such a repository as usable, so repository-local
# commands below abort with "fatal: not in a git directory". Register every repository next to the
# workspace as a safe directory up front, so the setup never depends on VS Code's Git extension
# having injected the entry for this container generation.
_repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"

# Register one directory as a safe directory when it is a repository root.
# Arguments: $1 - candidate directory; non-repository paths are ignored.
register_safe_directory() {
    local dir="$1"

    [[ -d "${dir}/.git" ]] || return 0

    if git config --global --get-all safe.directory | grep -qxF -- "${dir}"; then
        return 0
    fi

    git config --global --add safe.directory "${dir}"
}

register_safe_directory "${_repo_root}"
for _sibling in "${_repo_root%/*}"/*/; do
    register_safe_directory "${_sibling%/}"
done

if [[ -f package-lock.json ]]; then
    npm ci
else
    npm install
fi

uv python install 3.12
uv sync --all-groups --python 3.12
npx playwright install

# Commit/tag signing is dev-opt-in. Default: unsigned. `GIT_SIGNING_ENABLED=1`
# restores today's signing defaults exactly; the artifacts that must be signed
# are the publication commit, the release commit, and the `v*` tag, not the
# devcontainer's day-to-day commits. Hook installation, identity wiring, and
# GPG_TTY stay unconditional so flipping the switch is the only step needed.
if [[ "${GIT_SIGNING_ENABLED:-0}" == "1" ]]; then
    git config --global gpg.program /usr/bin/gpg
    git config --global gpg.format openpgp
    git config --global commit.gpgsign true
    git config --global tag.gpgSign true

    # Keep signing key user-specific; set via host env var GIT_SIGNING_KEY_ID if present.
    if [[ -n "${GIT_SIGNING_KEY_ID:-}" ]]; then
        git config --global user.signingkey "$GIT_SIGNING_KEY_ID"
    fi
fi

# Keep git identity user-specific; set via host env vars when present.
if [[ -n "${GIT_USER_NAME:-}" ]]; then
    git config --global user.name "$GIT_USER_NAME"
fi

if [[ -n "${GIT_USER_EMAIL:-}" ]]; then
    git config --global user.email "$GIT_USER_EMAIL"
fi

# GPG runs entirely inside the container against the persistent ~/.gnupg keyring
# (the micro-otter-gnupg volume). Import your private key once manually:
#   gpg --import /path/to/your-secret-key.asc
# The key persists across container rebuilds, so this only needs to be done once.
mkdir -p ~/.gnupg
chmod 700 ~/.gnupg
# Remove any stale forwarded-agent socket symlink left over from earlier setups,
# so gpg always uses the container-local keyring/agent.
rm -f ~/.gnupg/S.gpg-agent

# pinentry-curses can only prompt for a passphrase on a real terminal: git hands the terminal it
# signs from to gpg as GPG_TTY, and gpg fails with "Inappropriate ioctl for device" whenever that
# variable is missing - even in a perfectly healthy terminal. Interactive bash reads ~/.bashrc,
# while login shells (bash -l, sh -l, and the default profile of the VS Code terminal) read
# ~/.profile, so the same guarded block goes into both. The tty is resolved at every shell start
# because the device name changes with each terminal.
_gpg_tty_marker='# micro-otter: export GPG_TTY for pinentry'
_gpg_tty_block="${_gpg_tty_marker}
if [ -t 0 ] || [ -t 1 ]; then
    if _micro_otter_tty=\$(tty 2>/dev/null) && [ -n \"\${_micro_otter_tty}\" ]; then
        export GPG_TTY=\"\${_micro_otter_tty}\"
    fi
    unset _micro_otter_tty
fi"

for _gpg_rc in ~/.bashrc ~/.profile; do
    touch "${_gpg_rc}"
    # Replace the unguarded line written by earlier container generations.
    if grep -qxF 'export GPG_TTY=$(tty)' "${_gpg_rc}"; then
        grep -vxF 'export GPG_TTY=$(tty)' "${_gpg_rc}" > "${_gpg_rc}.micro-otter" || true
        mv "${_gpg_rc}.micro-otter" "${_gpg_rc}"
    fi
    if ! grep -qxF "${_gpg_tty_marker}" "${_gpg_rc}"; then
        printf '%s\n' "${_gpg_tty_block}" >> "${_gpg_rc}"
    fi
done
unset _gpg_tty_block _gpg_tty_marker _gpg_rc

# Point git at the repository's managed hooks directory so the commit-msg hook
# (device_version_hook.py) and pre-commit / pre-push scripts run automatically.
git config core.hooksPath hooks
chmod +x hooks/commit-msg hooks/pre-commit hooks/pre-push

# Bridge git's credential helper to the GitHub CLI so HTTPS git operations use
# the gh auth token instead of the VS Code-injected credential helper. The gh
# auth state itself is not baked into the image, so only wire it up when the CLI
# is already authenticated for this container.
if gh auth status >/dev/null 2>&1; then
    gh auth setup-git
    echo "Configured git to use gh as the credential helper for GitHub."
else
    echo "gh is not authenticated; skipping 'gh auth setup-git'. Run 'gh auth login' then 'gh auth setup-git'."
fi

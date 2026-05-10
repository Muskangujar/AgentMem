"""
agentmem.integrations.agentid — Optional AgentID integration.

If the developer has ``agentidentity-auth`` installed and passes an
``AgentIdentity`` object to ``Memory(identity=...)``, we extract the
cryptographic fingerprint (``ag:sha256:...``) and use it as the namespace.

This means every memory record is cryptographically bound to the agent's
verified Ed25519 identity.  Another agent cannot read or write to this
namespace without the matching private key.

Design pattern: **runtime detection, never hard dependencies.**
Each tool works alone.  Together, they get stronger.
"""

from __future__ import annotations

from typing import Any


def extract_fingerprint(identity: Any) -> str:
    """Extract the cryptographic fingerprint from an AgentIdentity object.

    Uses duck-typing: any object with a ``.fingerprint`` property that
    returns a string in ``ag:sha256:...`` format will work.  This avoids
    importing ``agentid`` at module level, so users without it installed
    never see an ``ImportError``.

    Parameters
    ----------
    identity : AgentIdentity
        An identity object from ``agentidentity-auth``.  Must have a
        ``.fingerprint`` property.

    Returns
    -------
    str
        The cryptographic fingerprint, e.g. ``"ag:sha256:022a6b57..."``.

    Raises
    ------
    TypeError
        If the object doesn't have a ``.fingerprint`` property.
    """
    fp = getattr(identity, "fingerprint", None)
    if fp is None:
        raise TypeError(
            f"Expected an AgentIdentity object with a .fingerprint property, "
            f"got {type(identity).__name__!r}.  "
            f"Install: pip install agentidentity-auth"
        )
    if not isinstance(fp, str):
        raise TypeError(
            f"identity.fingerprint must be a str, got {type(fp).__name__!r}"
        )
    return fp


def is_agentid_available() -> bool:
    """Check if the agentidentity-auth package is importable."""
    try:
        import agentid  # noqa: F401
        return True
    except ImportError:
        return False

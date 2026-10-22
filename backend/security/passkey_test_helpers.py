"""Synthetic WebAuthn ceremonies for tests, with private keys kept in memory.

These fixtures sign real ES256 assertions for the production verifier. They do
not access browsers, devices, accounts, databases, or credential files.
"""

import hashlib
import json
import secrets

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url


_DEFAULT_USER_HANDLE = object()


def client_data_json(challenge, *, origin, ceremony_type, cross_origin=False):
    """Encode the browser data that the synthetic authenticator will sign.

    Explicit overrides let tests sign invalid origins/types/cross-origin claims
    rather than bypassing verification. None omits the optional crossOrigin key.
    """
    if isinstance(challenge, str):
        challenge = base64url_to_bytes(challenge)
    data = {
        "type": ceremony_type,
        "challenge": bytes_to_base64url(bytes(challenge)),
        "origin": origin,
    }
    if cross_origin is not None:
        data["crossOrigin"] = cross_origin
    return json.dumps(data, separators=(",", ":")).encode("utf-8")


class SyntheticAuthenticator:
    """A new P-256 credential whose private key never leaves this instance."""

    def __init__(self, *, rp_id="testserver", origin="https://testserver",
                 credential_id=None, user_handle=None, sign_count=0):
        self.rp_id = rp_id
        self.origin = origin
        self.credential_id = secrets.token_bytes(32) if credential_id is None else bytes(credential_id)
        self.user_handle = secrets.token_bytes(32) if user_handle is None else bytes(user_handle)
        self.sign_count = sign_count
        self._private_key = ec.generate_private_key(ec.SECP256R1())
        public = self._private_key.public_key().public_numbers()
        # COSE EC2 / ES256 / P-256, followed by fixed-width x and y coordinates.
        self.credential_public_key = cbor2.dumps({
            1: 2, 3: -7, -1: 1,
            -2: public.x.to_bytes(32, "big"),
            -3: public.y.to_bytes(32, "big"),
        })

    @property
    def credential_id_b64(self):
        return bytes_to_base64url(self.credential_id)

    def _authenticator_data(self, *, rp_id, sign_count, user_present,
                            user_verified, attested=False,
                            backup_eligible=False, backed_up=False):
        flags = (int(user_present) | (int(user_verified) << 2)
                 | (int(backup_eligible) << 3) | (int(backed_up) << 4)
                 | (int(attested) << 6))
        data = (hashlib.sha256(rp_id.encode("utf-8")).digest()
                + bytes([flags]) + sign_count.to_bytes(4, "big"))
        if attested:
            data += (bytes(16) + len(self.credential_id).to_bytes(2, "big")
                     + self.credential_id + self.credential_public_key)
        return data

    def registration(self, challenge, *, origin=None, rp_id=None, sign_count=None,
                     user_present=True, user_verified=True,
                     ceremony_type="webauthn.create", cross_origin=False,
                     backup_eligible=False, backed_up=False):
        """Return JSON suitable for a navigator.credentials.create response."""
        if sign_count is not None:
            self.sign_count = sign_count
        client_data = client_data_json(
            challenge, origin=self.origin if origin is None else origin,
            ceremony_type=ceremony_type, cross_origin=cross_origin,
        )
        auth_data = self._authenticator_data(
            rp_id=self.rp_id if rp_id is None else rp_id,
            sign_count=self.sign_count, user_present=user_present,
            user_verified=user_verified, attested=True,
            backup_eligible=backup_eligible, backed_up=backed_up,
        )
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": self.credential_id_b64, "rawId": self.credential_id_b64,
            "type": "public-key", "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "attestationObject": bytes_to_base64url(attestation),
                "transports": ["internal"],
            },
        }

    def authentication(self, challenge, *, origin=None, rp_id=None, sign_count=None,
                       user_present=True, user_verified=True,
                       ceremony_type="webauthn.get", cross_origin=False,
                       user_handle=_DEFAULT_USER_HANDLE,
                       backup_eligible=False, backed_up=False):
        """Return a real ECDSA assertion; sign_count=None increments the counter.

        user_handle=None represents a browser returning no userHandle. A byte
        value overrides the handle without changing the credential's owner.
        """
        self.sign_count = self.sign_count + 1 if sign_count is None else sign_count
        client_data = client_data_json(
            challenge, origin=self.origin if origin is None else origin,
            ceremony_type=ceremony_type, cross_origin=cross_origin,
        )
        auth_data = self._authenticator_data(
            rp_id=self.rp_id if rp_id is None else rp_id,
            sign_count=self.sign_count, user_present=user_present,
            user_verified=user_verified, backup_eligible=backup_eligible,
            backed_up=backed_up,
        )
        signature = self._private_key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256()),
        )
        handle = self.user_handle if user_handle is _DEFAULT_USER_HANDLE else user_handle
        return {
            "id": self.credential_id_b64, "rawId": self.credential_id_b64,
            "type": "public-key", "authenticatorAttachment": "platform",
            "clientExtensionResults": {},
            "response": {
                "clientDataJSON": bytes_to_base64url(client_data),
                "authenticatorData": bytes_to_base64url(auth_data),
                "signature": bytes_to_base64url(signature),
                "userHandle": None if handle is None else bytes_to_base64url(bytes(handle)),
            },
        }

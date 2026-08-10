# ============================================================================
# Lab 4 — Data Security & Encryption
#
# Nothing to write here. This session adds no Temporal Cloud resources.
#
# The work is in labs/proxy/ — a temporal-proxy config that puts an encrypting
# gateway between your worker and Cloud. See labs/proxy/README.md.
#
# Earlier versions of this lab recorded "I verified ciphertext" as a namespace
# tag. That was a claim, not evidence. The exit check now reads the payload
# metadata out of your namespace and looks for encoding: binary/encrypted — so
# the tag was not just unnecessary, it was pretending to be a verification.
#
# One thing NOT to add, here or anywhere: a codec server on your namespace. It
# would give the Cloud UI a path to decrypt your payloads, which is the exact
# property this session exists to remove. The grader fails you if one appears.
# ============================================================================

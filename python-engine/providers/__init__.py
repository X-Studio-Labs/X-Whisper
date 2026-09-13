"""
X-Whisper — Providers Package

Houses the BaseProvider interface and the registry that routes model
IDs to their implementing backend (whisper.cpp for local STT, Groq
for cloud).
"""

from .base import (
    BaseProvider,
    LoadResult,
    TranscribeOptions,
    TranscribeResult,
    PartialResult,
    ProviderNotAvailableError,
)
from .whisper_cpp_provider import WhisperCppProvider
from .groq_provider import GroqProvider
from . import registry

__all__ = [
    "BaseProvider",
    "LoadResult",
    "TranscribeOptions",
    "TranscribeResult",
    "PartialResult",
    "ProviderNotAvailableError",
    "WhisperCppProvider",
    "GroqProvider",
    "registry",
]

"""Rotary position embedding: the part of lucidrains' rotary-embedding-torch 0.9.2
that BS-RoFormer uses ('lang' frequencies, no xpos, no learned frequencies).
MIT licence, see LICENSE. The parameter name (`freqs`) matches the original so
saved weights load unchanged."""
import torch
from torch import nn
from einops import rearrange, repeat


def rotate_half(x):
    x = rearrange(x, '... (d r) -> ... d r', r=2)
    x1, x2 = x.unbind(dim=-1)
    x = torch.stack((-x2, x1), dim=-1)
    return rearrange(x, '... d r -> ... (d r)')


def apply_rotary_emb(freqs, t):
    dtype = t.dtype
    rot_dim = freqs.shape[-1]
    t_middle, t_right = t[..., :rot_dim], t[..., rot_dim:]
    t_transformed = (t_middle * freqs.cos()) + (rotate_half(t_middle) * freqs.sin())
    return torch.cat((t_transformed, t_right), dim=-1).type(dtype)


class RotaryEmbedding(nn.Module):
    def __init__(self, dim, theta=10000):
        super().__init__()
        freqs = 1. / (theta ** (torch.arange(0, dim, 2)[:(dim // 2)].float() / dim))
        self.freqs = nn.Parameter(freqs, requires_grad=False)
        self._cache = None  # (seq_len, device, freqs): the same length comes back every chunk

    def forward(self, seq_len, device):
        c = self._cache
        if c is not None and c[0] == seq_len and c[1] == device:
            return c[2]
        t = torch.arange(seq_len, device=device, dtype=self.freqs.dtype)
        freqs = torch.einsum('..., f -> ... f', t, self.freqs.to(device))
        freqs = repeat(freqs, '... n -> ... (n r)', r=2)
        self._cache = (seq_len, device, freqs)
        return freqs

    def rotate_queries_or_keys(self, t):
        """t: (..., seq, dim); the sequence is the second last dimension."""
        freqs = self.forward(t.shape[-2], t.device)
        return apply_rotary_emb(freqs.to(t.dtype) if t.dtype != freqs.dtype else freqs, t)

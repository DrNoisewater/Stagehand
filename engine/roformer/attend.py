"""Attention for BS-RoFormer, from ZFTurbo's Music-Source-Separation-Training
(models/bs_roformer/attend.py, MIT, see LICENSE). Trimmed for inference: PyTorch
picks the fastest attention kernel the device has by itself."""
import torch
from torch import nn
import torch.nn.functional as F


class Attend(nn.Module):
    def __init__(self, dropout=0., flash=False, scale=None):
        super().__init__()
        self.scale = scale
        self.dropout = dropout
        self.attn_dropout = nn.Dropout(dropout)
        self.flash = flash

    def forward(self, q, k, v):
        """q, k, v: (batch, heads, sequence, feature)"""
        if self.flash:
            if self.scale is not None:
                q = q * (self.scale / (q.shape[-1] ** -0.5))
            return F.scaled_dot_product_attention(q, k, v, dropout_p=self.dropout if self.training else 0.)
        scale = self.scale if self.scale is not None else q.shape[-1] ** -0.5
        sim = torch.einsum("b h i d, b h j d -> b h i j", q, k) * scale
        attn = self.attn_dropout(sim.softmax(dim=-1))
        return torch.einsum("b h i j, b h j d -> b h i d", attn, v)

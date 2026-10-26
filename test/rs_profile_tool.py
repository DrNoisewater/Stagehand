"""
Independent Rocksmith save-file tool for tests (uses Python's cryptography +
zlib, not Stagehand's code). Formatting follows rsrtools' documented Ubisoft
rules, so files look like the game's own.

  python rs_profile_tool.py make <steam_dir>      build a fake Steam folder
  python rs_profile_tool.py dump <save_file>      print header + JSON + format check
"""
import hashlib
import json
import os
import struct
import sys
import zlib

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

KEY = bytes.fromhex("728B369E24ED0134768511021812AFC0A3C25D02065F166B4BCC58CD2644F29E")
ACCOUNT = "12345678"
UNIQUE = "8A3E1C55D0F24B7A"
DEC = {"__LASTMOD__": "1700000000.000000", "__MASTERY__": "0.500000"}


def ubisoft_json(obj):
    """rsrtools' reconstruction of Rocksmith's JSON layout (see savefile.py)."""
    payload = json.dumps(obj, separators=(",", " : "), indent=0, ensure_ascii=True)
    payload = payload.replace('" : [', '" : \n[')
    payload = payload.replace(" : {}", " : {\n}")
    payload = payload.replace("\n[]", "\n[\n]")
    payload = payload.replace("\n{}", "\n{\n}")
    payload = payload.replace("\n[\n[", "\n[\n\n[")
    payload = payload.replace("\n],\n[", "\n],\n\n[")
    payload = payload.replace("\n[]", "\n[\n]")
    for k, v in DEC.items():
        payload = payload.replace('"%s"' % k, v)
    return payload


def encode(header, text):
    payload = text.encode("utf-8") + b"\x00"
    z = zlib.compress(payload, 9)
    pad = (16 - len(z) % 16) % 16
    if pad:
        z += b"\x00" + bytes([pad]) * (pad - 1)
    enc = Cipher(algorithms.AES(KEY), modes.ECB()).encryptor()
    body = enc.update(z) + enc.finalize()
    return header + struct.pack("<L", len(payload)) + body


def decode(data):
    assert data[:4] == b"EVAS", "bad magic"
    header = data[:16]
    size = struct.unpack("<L", data[16:20])[0]
    dec = Cipher(algorithms.AES(KEY), modes.ECB()).decryptor()
    plain = dec.update(data[20:]) + dec.finalize()
    payload = zlib.decompressobj().decompress(plain)
    assert len(payload) == size, "size mismatch %d != %d" % (len(payload), size)
    assert payload[-1:] == b"\x00", "not NUL terminated"
    return header, payload[:-1].decode("utf-8")


def make(steam):
    remote = os.path.join(steam, "userdata", ACCOUNT, "221680", "remote")
    os.makedirs(remote, exist_ok=True)
    os.makedirs(os.path.join(steam, "userdata", ACCOUNT, "config"), exist_ok=True)
    with open(os.path.join(steam, "userdata", ACCOUNT, "config", "localconfig.vdf"), "w") as f:
        f.write('"UserLocalConfigStore"\n{\n\t"friends"\n\t{\n\t\t"PersonaName"\t\t"TestPlayer"\n\t}\n}\n')
    profile = {
        "Stats": {"TimePlayed": 123456.25, "Mastery": "__MASTERY__", "SessionCount": 42},
        "Playnexts": {"Songs": {}},
        "SongListsRoot": {"SongLists": [["BlitzkriegBop", "IntegrationTest"], ["CallMe"], [], [], [], []]},
        "FavoritesListRoot": {"FavoritesList": ["CallMe"]},
        "Songs": {"B3F2205092AF43B9BBE96441B8F99058": {"PlayedCount": 3, "TimeStamp": 1700000000.5}},
        "CustomTones": [{"Name": "Café Crunch", "Key": "Tone_1"}],
        "Achievements": [],
        "LastModified": "__LASTMOD__",
    }
    header = b"EVAS" + struct.pack("<L", 1) + struct.pack("<Q", 0x8A3E1C55D0F24B7A)
    prof = encode(header, ubisoft_json(profile))
    with open(os.path.join(remote, UNIQUE + "_PRFLDB"), "wb") as f:
        f.write(prof)
    local = {"Profiles": [{"PlayerName": "Jamie", "UniqueID": UNIQUE, "LastModified": "__LASTMOD__"}], "Version": 1}
    lp = encode(b"EVAS" + struct.pack("<L", 1) + struct.pack("<Q", 0), ubisoft_json(local))
    with open(os.path.join(remote, "LocalProfiles.json"), "wb") as f:
        f.write(lp)
    sha = lambda b: hashlib.sha1(b).hexdigest()
    vdf = '"221680"\n{\n\t"ChangeNumber"\t\t"7"\n\t"ostype"\t\t"-184"\n'
    for name, data in ((UNIQUE + "_PRFLDB", prof), ("LocalProfiles.json", lp)):
        vdf += (
            '\t"%s"\n\t{\n\t\t"root"\t\t"0"\n\t\t"size"\t\t"%d"\n\t\t"localtime"\t\t"1700000000"\n'
            '\t\t"time"\t\t"1700000000"\n\t\t"remotetime"\t\t"1700000000"\n\t\t"sha"\t\t"%s"\n'
            '\t\t"syncstate"\t\t"1"\n\t\t"persiststate"\t\t"0"\n\t\t"platformstosync2"\t\t"-1"\n\t}\n'
        ) % (name, len(data), sha(data))
    vdf += "}\n"
    with open(os.path.join(steam, "userdata", ACCOUNT, "221680", "remotecache.vdf"), "w") as f:
        f.write(vdf)
    print(json.dumps({"profile": os.path.join(remote, UNIQUE + "_PRFLDB")}))


def dump(path):
    with open(path, "rb") as f:
        data = f.read()
    header, text = decode(data)
    obj = json.loads(text)
    # Does the text match Rocksmith's own layout exactly?
    canon = ubisoft_json(json.loads(text.replace("1700000000.000000", '"__LASTMOD__"').replace("0.500000", '"__MASTERY__"')))
    print(json.dumps({
        "header": header.hex(),
        "json": obj,
        "ubisoftLayout": canon == text,
        "sha1": hashlib.sha1(data).hexdigest(),
        "size": len(data),
        "text": text,
    }))


if __name__ == "__main__":
    {"make": make, "dump": dump}[sys.argv[1]](sys.argv[2])

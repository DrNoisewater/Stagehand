"""
Writes MusicBrainz-shaped JSON (ws/2, fmt=json) for invented artists into
test/fixtures/musicbrainz, so Discover can be tested without the network.
Run: python test/make_mb_fixtures.py
"""
import json
import os
import re
import uuid

OUT = os.path.join(os.path.dirname(__file__), 'fixtures', 'musicbrainz')
NS = uuid.UUID('6f1c4a52-1d0e-4b7e-9a51-1e8f3e0c2a10')


def uid(*parts):
    return str(uuid.uuid5(NS, '|'.join(parts)))


def slug(s):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))


def write(name, data):
    with open(os.path.join(OUT, name + '.json'), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=1, ensure_ascii=False)


ARTISTS = {
    'lantern': dict(name='The Lantern Hours', sort='Lantern Hours, The', type='Group', country='GB', dis='indie rock band from Leeds', begin='2006'),
    'mara': dict(name='Mara Quell', sort='Quell, Mara', type='Person', country='US', dis='singer-songwriter', begin='1988-04-02'),
    'ns1': dict(name='Northbound Statics', sort='Northbound Statics', type='Group', country='CA', dis='post-punk band', begin='2011'),
    'ns2': dict(name='North Bound Static', sort='North Bound Static', type='Group', country='AU', dis='surf rock duo', begin='2015'),
}

# (title, primary, secondary, date, [releases: (date, country, [tracks])])
LANTERN = [
    ('First Light', 'Album', [], '2009-03-02', [
        ('2009-03-02', 'GB', ['Static Bloom', 'Undertow', 'First Light', 'Copper Wire', 'Glasshouse', 'Saltmarsh', 'Two Rivers', 'Low Sun', 'Weathervane', 'Still Water'])]),
    ('Live at the Roundhouse', 'Album', ['Live'], '2011-06-10', [
        ('2011-06-10', 'GB', ['Static Bloom', 'Undertow', 'Harbour Lights'])]),
    ('Signal Fires', 'Album', [], '2012-09-17', [
        ('2012-09-17', 'GB', ['Harbour Lights', 'Signal Fires', 'Ghost Notes', 'Northern Line', 'Embers', 'Slow Burn', 'Lighthouse Keeper', 'Bellwether', 'Cinder Path', 'Morning Tide', 'Signal Fires (Reprise)'])]),
    ('Night Ferry', 'EP', [], '2014-02-24', [
        ('2014-02-24', 'GB', ['Night Ferry', 'Kingfisher', 'Lowlands', 'Quiet Harbour'])]),
    ('The Best of The Lantern Hours', 'Album', ['Compilation'], '2016-11-04', [
        ('2016-11-04', 'GB', ['Static Bloom', 'Harbour Lights', 'Night Ferry'])]),
    ('Paper Moons', 'Album', [], '2017-05-12', [
        ('2018-05-11', 'GB', ['Paper Moons', 'Satellite', 'Pilot Light', 'Hollow Bones', 'Arcadia', 'Lamplighter', 'Tin Roof', 'Velvet Static', 'Night Swimming', 'Long Way Down', 'Afterglow', 'Homeward', 'Paper Moons (Demo)', 'Satellite (Acoustic)', 'Arcadia (Live)', 'Bonus Light']),
        ('2017-05-12', 'GB', ['Paper Moons', 'Satellite', 'Pilot Light', 'Hollow Bones', 'Arcadia', 'Lamplighter', 'Tin Roof', 'Velvet Static', 'Night Swimming', 'Long Way Down', 'Afterglow', 'Homeward'])]),
    ('Kingfisher (Remixes)', 'EP', ['Remix'], '2018-01-19', [
        ('2018-01-19', 'GB', ['Kingfisher (Club Mix)'])]),
]

MARA = [
    ('Quiet Engines', 'Album', [], '2015-08-21', [
        ('2015-08-21', 'US', ['Quiet Engines', 'Ironwood', 'Blue Hour', 'Wildfire Season', 'Gravel Road', 'Telegraph', 'Seventeen Miles', 'Paper Crown'])]),
    ('Tall Grass', 'Album', [], '2019-10-04', [
        ('2019-10-04', 'US', ['Tall Grass', 'Riverbend', 'Dust & Diamonds', 'Kerosene', 'Open Country', 'Harvest Moon Waltz', 'Ninety Days', 'Goodnight, Ohio'])]),
]

LENGTHS = [214000, 251000, 198000, 263000, 187000, 305000, 242000, 228000, 276000, 199000, 233000, 219000, 160000, 175000, 290000, 140000]


def artist_json(key, score=100):
    a = ARTISTS[key]
    return {
        'id': uid('artist', key), 'type': a['type'], 'score': score, 'name': a['name'], 'sort-name': a['sort'],
        'country': a['country'], 'disambiguation': a['dis'], 'life-span': {'begin': a['begin'], 'ended': None},
    }


def discography(key, groups):
    aid = uid('artist', key)
    rgs = []
    for title, primary, secondary, date, releases in groups:
        gid = uid('rg', key, title)
        rgs.append({'id': gid, 'title': title, 'primary-type': primary, 'secondary-types': secondary, 'first-release-date': date, 'disambiguation': ''})
        rels = []
        for i, (rdate, country, tracks) in enumerate(releases):
            rels.append({
                'id': uid('release', key, title, str(i)), 'title': title, 'status': 'Official', 'date': rdate, 'country': country,
                'media': [{'position': 1, 'format': 'Digital Media', 'track-count': len(tracks), 'tracks': [
                    {'id': uid('track', key, title, str(i), t), 'number': str(n + 1), 'position': n + 1, 'title': t, 'length': LENGTHS[n % len(LENGTHS)],
                     'recording': {'id': uid('rec', key, t), 'title': t, 'length': LENGTHS[n % len(LENGTHS)]}}
                    for n, t in enumerate(tracks)]}],
            })
        write(f'releases_{gid}', {'release-count': len(rels), 'release-offset': 0, 'releases': rels})
    write(f'release-groups_{aid}', {'release-group-count': len(rgs), 'release-group-offset': 0, 'release-groups': rgs})
    write(f'artist_{aid}', {k: v for k, v in artist_json(key).items() if k != 'score'})
    return rgs


def recording(key, title, album, primary, date, score=100, secondary=None):
    a = ARTISTS[key]
    return {
        'id': uid('rec', key, title), 'score': score, 'title': title, 'length': 214000,
        'artist-credit': [{'name': a['name'], 'artist': {'id': uid('artist', key), 'name': a['name'], 'sort-name': a['sort']}}],
        'first-release-date': date,
        'releases': [{'id': uid('release', key, album, '0'), 'title': album, 'status': 'Official', 'date': date,
                      'release-group': {'id': uid('rg', key, album), 'primary-type': primary, 'secondary-types': secondary or []}}],
    }


def main():
    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith('.json'):
            os.remove(os.path.join(OUT, f))
    discography('lantern', LANTERN)
    discography('mara', MARA)
    discography('ns1', [('Cold Frequencies', 'Album', [], '2014-03-01', [('2014-03-01', 'CA', ['Cold Frequencies', 'Pylon'])])])
    discography('ns2', [('Board Shorts', 'EP', [], '2016-12-01', [('2016-12-01', 'AU', ['Board Shorts', 'Rip Current'])])])

    lantern = {'created': '2026-10-11T00:00:00Z', 'count': 1, 'offset': 0, 'artists': [artist_json('lantern')]}
    for q in ['The Lantern Hours', 'Lantern Hours', 'lantern hours', 'lantern']:
        write(f'artist-search_{slug(q)}', lantern)
    write('artist-search_mara-quell', {'count': 1, 'offset': 0, 'artists': [artist_json('mara')]})
    write('artist-search_northbound-static', {'count': 2, 'offset': 0, 'artists': [artist_json('ns1', 88), artist_json('ns2', 81)]})

    night = [
        recording('lantern', 'Night Ferry', 'Night Ferry', 'EP', '2014-02-24'),
        recording('lantern', 'Night Ferry (Live)', 'Live at the Roundhouse', 'Album', '2011-06-10', 92, ['Live']),
        recording('mara', 'Night Ferry Blues', 'Tall Grass', 'Album', '2019-10-04', 74),
    ]
    write('recording-search_' + slug('recording:"night ferry" AND status:official'), {'count': len(night), 'offset': 0, 'recordings': night})
    # Song search matches titles, like MusicBrainz's recording index.
    harbour = [
        recording('lantern', 'Harbour Lights', 'Signal Fires', 'Album', '2012-09-17'),
        recording('lantern', 'Harbour Lights (Live)', 'Live at the Roundhouse', 'Album', '2011-06-10', 95, ['Live']),
        recording('lantern', 'Quiet Harbour', 'Night Ferry', 'EP', '2014-02-24', 90),
        recording('mara', 'Harbour Town', 'Quiet Engines', 'Album', '2015-08-21', 70),
    ]
    write('recording-search_' + slug('recording:"harbour" AND status:official'), {'count': len(harbour), 'offset': 0, 'recordings': harbour})
    king = recording('lantern', 'Kingfisher', 'Night Ferry', 'EP', '2014-02-24')
    write('recording-search_' + slug('recording:"kingfisher" AND artist:"the lantern hours" AND status:official'), {'count': 1, 'offset': 0, 'recordings': [king]})
    print('wrote', len(os.listdir(OUT)), 'files to', OUT)
    return {k: uid('artist', k) for k in ARTISTS}, {t[0]: uid('rg', 'lantern', t[0]) for t in LANTERN}


if __name__ == '__main__':
    ids, groups = main()
    covers = os.environ.get('COVERS')
    if covers:
        # Simple abstract covers for screenshots.
        from PIL import Image, ImageDraw, ImageFilter
        import random
        palette = [((255, 181, 71), (31, 39, 64)), ((140, 123, 255), (19, 24, 38)), ((51, 200, 224), (28, 35, 55)), ((255, 107, 61), (23, 29, 45)), ((155, 219, 90), (24, 30, 46)), ((255, 77, 141), (20, 26, 40))]
        allgroups = [(k, t[0]) for k, ts in (('lantern', LANTERN), ('mara', MARA)) for t in ts]
        for i, (key, title) in enumerate(allgroups):
            if i % 5 == 3:
                continue  # some albums have no cover
            fg, bg = palette[i % len(palette)]
            im = Image.new('RGB', (250, 250), bg)
            d = ImageDraw.Draw(im)
            rnd = random.Random(title)
            for _ in range(7):
                r = rnd.randint(30, 120)
                x, y = rnd.randint(-20, 250), rnd.randint(-20, 250)
                col = tuple(int(c * rnd.uniform(0.45, 1.0)) for c in fg)
                d.ellipse([x - r, y - r, x + r, y + r], fill=col)
            im = im.filter(ImageFilter.GaussianBlur(14))
            d = ImageDraw.Draw(im)
            d.rectangle([18, 196, 232, 200], fill=(236, 238, 246))
            im.save(os.path.join(OUT, f'cover_{uid("rg", key, title)}.jpg'), quality=86)
        print('covers written')
    print(json.dumps(ids, indent=1))

# Chord scoring (4.7.1): notes

Status: done, tested on synthesised strums only. Waiting on the user's feel with a real guitar.

Decisions and why:
- No outside code: the good chord tools are GPL/AGPL; Basic Pitch needs TensorFlow.js and is offline; light MIT libs are single-note.
- Catch a wrong chord by evidence of a specific wrong fret (a missing chord note plus a fresh note 1–2 semitones away), not by
  penalising stray notes: the user wants it forgiving.
- Per note name, not per string: a note heard on any string is fine.

Dead ends:
- Comparing harmonic sums on the "new energy" spectrum (`_newEnergy`): onset frames smear peaks, and for a repeated chord
  subtracting the previous spectrum splits each peak in two, so a neighbour looked as strong as the real note. Fixed by
  using a settled frame (onset + 90–200 ms) and real peaks only.
- Excluding every harmonic that comes near another chord note with a wide tolerance: almost all harmonics get excluded
  (a low E's harmonics are only ~140 cents apart up high). Now: first 12 harmonics, ±30 cents.
- Using the old salience test for "heard": the major third (5th harmonic of the root) reads as present when it isn't.

Benchmark: test/chords.test.mjs (N=3). The fuller N=10 run lives in HANDOFF's 4.7.1 table.

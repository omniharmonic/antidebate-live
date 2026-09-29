from adl_capture.merge import merge
from adl_capture.offline import speaker_summary, turns_from_fluidaudio, words_from_fluidaudio

ASR = {"wordTimings": [
    {"word": "Audits", "startTime": 0.10, "endTime": 0.50, "confidence": 0.99},
    {"word": "are", "startTime": 0.55, "endTime": 0.70, "confidence": 0.98},
    {"word": "fine.", "startTime": 0.75, "endTime": 1.10, "confidence": 0.97},
    {"word": " ", "startTime": 1.10, "endTime": 1.11},
    {"word": "Licensing", "startTime": 1.60, "endTime": 2.10, "confidence": 0.95},
    {"word": "isn't.", "startTime": 2.15, "endTime": 2.60, "confidence": 0.90},
]}
DIAR = {"segments": [
    {"speakerId": "S1", "startTimeSeconds": 0.0, "endTimeSeconds": 1.3, "qualityScore": 1, "embedding": [0.1]},
    {"speakerId": "S2", "startTimeSeconds": 1.4, "endTimeSeconds": 3.0, "qualityScore": 1, "embedding": [0.2]},
]}


def test_parses_fluidaudio_words_to_ms_and_drops_blanks():
    words = words_from_fluidaudio(ASR)
    assert [w.text for w in words] == ["Audits", "are", "fine.", "Licensing", "isn't."]
    assert (words[0].start_ms, words[0].end_ms, words[0].confidence) == (100, 500, 0.99)


def test_parses_fluidaudio_segments_to_turns():
    turns = turns_from_fluidaudio(DIAR)
    assert [(t.speaker, t.start_ms, t.end_ms) for t in turns] == [("S1", 0, 1300), ("S2", 1400, 3000)]


def test_merge_and_summary_split_by_speaker():
    utts = merge(words_from_fluidaudio(ASR), turns_from_fluidaudio(DIAR))
    assert [(u["speaker"], u["text"]) for u in utts] == [("S1", "Audits are fine."), ("S2", "Licensing isn't.")]
    summary = speaker_summary(utts)
    assert [s[0] for s in summary] == ["S1", "S2"]
    assert summary[0][2] == 1

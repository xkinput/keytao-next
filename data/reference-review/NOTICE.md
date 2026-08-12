# Reference review data

These vendored files are used only to populate the PostgreSQL review-reference
tables. They are not imported by the Next.js runtime and therefore are not part
of a serverless function bundle.

- `large_pinyin.txt`, `zdic_cibs.txt`, and `zdic_cybs.txt` come from the
  `phrase-pinyin-data` bundle (version 0.19.0 where recorded) and are distributed
  under the supplied MIT `LICENSE`.
- `cedict.txt` is CC-CEDICT. Its source header carries the Creative Commons
  Attribution-ShareAlike 4.0 notice and upstream attribution.
- `jieba_dict.txt` is the supplied jieba frequency dictionary and is licensed
  under MIT according to the verified source manifest for this bundle.

The importer preserves dataset identifiers in every pronunciation row so the
review UI can display honest provenance labels.

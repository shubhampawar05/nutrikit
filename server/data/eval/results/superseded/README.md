# Superseded Gemini runs

These runs used concurrency 2 while other runs shared the same Gemini key, so many batches failed on rate limits
and coverage varied from 12% to 100% between runs. That changes which dishes are scored, so they are not used for
comparisons. They are kept as evidence of the rate-limit behaviour (the failure counts per call are in each file).
The paced, one-at-a-time reruns (`--concurrency 1 --pace 4000`) replace them.

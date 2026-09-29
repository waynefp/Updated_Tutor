// Measures how long the tutor takes to answer: from the moment the local mic
// goes quiet to the first reply audio. The mic check runs every 250ms, so
// readings are accurate to roughly a quarter second. Same method for every
// engine, so the numbers are comparable.
export function createReplyTimer() {
  let speechEndedAt: number | null = null;

  return {
    speechStarted() {
      speechEndedAt = null;
    },
    speechStopped() {
      speechEndedAt = performance.now();
    },
    // Returns the reply time once per learner turn, or null if there is no
    // learner turn waiting for an answer (e.g. the tutor speaking first).
    replyAudioStarted(): number | null {
      if (speechEndedAt === null) return null;
      const elapsed = Math.round(performance.now() - speechEndedAt);
      speechEndedAt = null;
      return elapsed;
    },
    reset() {
      speechEndedAt = null;
    }
  };
}

export function medianMs(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

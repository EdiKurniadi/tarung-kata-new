class AiOpponent {
  constructor() { this.name = 'Computer'; }
  guessWord(match) {
    const words = match.candidates();
    return words.length ? words[Math.floor(Math.random() * words.length)] : null;
  }
  determineRules(match) {
    const state = match.state;
    const word = state.rows[state.rows.length - 1].word;
    // Pick a complete valid plan, including all required colors. Backtracking
    // avoids repeated letters trapping the computer at the black rule.
    const plans = WordWarMatch.rulePlans(word, WordWarMatch.requiredRules(state.rows.length), state.selected);
    return plans.length ? plans[Math.floor(Math.random() * plans.length)] : null;
  }
}
const aiOpponent = new AiOpponent();

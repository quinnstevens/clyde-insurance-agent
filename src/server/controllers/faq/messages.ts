/**
 * What the agent says when it isn't reading an FAQ answer. Answers themselves are the clinic's own
 * words and are read out unchanged.
 */
export const faqMessages = {
  clarify: (questions: string[]) =>
    questions.length === 1
      ? `Just to make sure I get this right, are you asking: ${questions[0]}`
      : `Just so I give you the right answer, did you mean: ${questions.slice(0, -1).join(' Or: ')} Or: ${questions[questions.length - 1]}`,

  unanswered: () =>
    `I'm sorry, I don't have an answer to that one. I've noted your question for our team, and our front desk can help you with it.`,
}

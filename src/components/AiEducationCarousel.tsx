"use client";

import React from "react";

interface AiEducationCarouselProps {
  onSelectQuestion: (question: string) => void;
}

const SECURITY_QUESTIONS = [
  {
    icon: "🤖",
    tag: "Sweeper Bots",
    question: "What is a Sweeper Bot and how do hackers drain gas in <8 seconds?",
    color: "var(--red)",
  },
  {
    icon: "⚡",
    tag: "EIP-7702",
    question: "What is EIP-7702 and how does it upgrade wallets on Base?",
    color: "var(--blue-hi)",
  },
  {
    icon: "🔍",
    tag: "Case Study",
    question: "How did the $23.75M Ostium hack happen without a smart contract bug?",
    color: "var(--amber)",
  },
  {
    icon: "🔒",
    tag: "Approvals",
    question: "Why are unlimited token approvals (uint256.max) dangerous?",
    color: "var(--blue)",
  },
  {
    icon: "🍯",
    tag: "Scam Detection",
    question: "How do I recognize a honeypot token or fake airdrop on Base?",
    color: "var(--green)",
  },
  {
    icon: "🛡️",
    tag: "Money Trail",
    question: "How does Shield's 2-hop traversal catch brand new burner wallets?",
    color: "var(--blue-hi)",
  },
];

export default function AiEducationCarousel({ onSelectQuestion }: AiEducationCarouselProps) {
  return (
    <section className="educationCarouselSection" aria-label="Interactive Security Questions">
      <div className="carouselHeaderRow">
        <div className="carouselTitleGroup">
          <span className="sparkleIcon" aria-hidden="true">✨</span>
          <span className="carouselHeading">Interactive Security Intelligence</span>
          <span className="carouselSubTag">Click any topic to ask Shield Copilot</span>
        </div>
      </div>

      <div className="carouselTrackWrapper" tabIndex={0} aria-label="Scrollable list of security questions">
        <div className="carouselTrack">
          {/* Primary Interactive Track */}
          {SECURITY_QUESTIONS.map((item, index) => (
            <button
              key={`primary-${index}`}
              type="button"
              className="carouselCardBtn"
              onClick={() => onSelectQuestion(item.question)}
              aria-label={`Ask AI: ${item.question}`}
            >
              <div className="cardTopLine">
                <span className="itemIcon" aria-hidden="true">{item.icon}</span>
                <span
                  className="itemTag"
                  style={{ color: item.color, borderColor: `${item.color}40` }}
                >
                  {item.tag}
                </span>
                <span className="askArrow" aria-hidden="true">Ask ↗</span>
              </div>
              <p className="cardQuestion">{item.question}</p>
            </button>
          ))}

          {/* Duplicated Track for Smooth Infinite Looping with aria-hidden="true" */}
          {SECURITY_QUESTIONS.map((item, index) => (
            <button
              key={`loop-${index}`}
              type="button"
              className="carouselCardBtn"
              onClick={() => onSelectQuestion(item.question)}
              aria-hidden="true"
              tabIndex={-1}
            >
              <div className="cardTopLine">
                <span className="itemIcon" aria-hidden="true">{item.icon}</span>
                <span
                  className="itemTag"
                  style={{ color: item.color, borderColor: `${item.color}40` }}
                >
                  {item.tag}
                </span>
                <span className="askArrow" aria-hidden="true">Ask ↗</span>
              </div>
              <p className="cardQuestion">{item.question}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

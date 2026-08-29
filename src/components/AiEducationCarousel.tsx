"use client";

import React, { useState } from "react";
import Icon, { type IconName } from "./Icon";

interface AiEducationCarouselProps {
  onSelectQuestion: (question: string) => void;
}

interface SecurityQuestion {
  icon: IconName;
  tag: string;
  question: string;
  color: string;
}

const SECURITY_QUESTIONS: SecurityQuestion[] = [
  {
    icon: "bot",
    tag: "Sweeper Bots",
    question: "What is a Sweeper Bot and how do hackers drain gas in <8 seconds?",
    color: "var(--red)",
  },
  {
    icon: "key",
    tag: "EIP-7702",
    question: "What is EIP-7702 and how does it upgrade wallets on Base?",
    color: "var(--blue-hi)",
  },
  {
    icon: "scan",
    tag: "Case Study",
    question: "How did the $23.75M Ostium hack happen without a smart contract bug?",
    color: "var(--amber)",
  },
  {
    icon: "shield-alert",
    tag: "Approvals",
    question: "Why are unlimited token approvals (uint256.max) dangerous?",
    color: "var(--blue)",
  },
  {
    icon: "alert",
    tag: "Scam Detection",
    question: "How do I recognize a honeypot token or fake airdrop on Base?",
    color: "var(--green)",
  },
  {
    icon: "link",
    tag: "Money Trail",
    question: "How does Shield's 2-hop traversal catch brand new burner wallets?",
    color: "var(--blue-hi)",
  },
];

export default function AiEducationCarousel({ onSelectQuestion }: AiEducationCarouselProps) {
  /**
   * Sticky pause: the first pointerdown stops the marquee for good, so a card
   * can be tapped or its text selected without sliding out from under the
   * cursor. Hover and keyboard focus pause it too (see globals.css).
   */
  const [paused, setPaused] = useState(false);

  return (
    <section className="educationCarouselSection" aria-label="Interactive Security Questions">
      <div className="carouselHeaderRow">
        <div className="carouselTitleGroup">
          <Icon name="bot" size={16} />
          <span className="carouselHeading">Interactive Security Intelligence</span>
          <span className="carouselSubTag">Click any topic to ask Shield Copilot</span>
        </div>
      </div>

      <div
        className="carouselTrackWrapper"
        tabIndex={0}
        aria-label="Scrollable list of security questions"
        data-paused={paused ? "true" : "false"}
        onPointerDown={() => setPaused(true)}
      >
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
                <Icon name={item.icon} size={18} className="itemIcon" />
                <span
                  className="itemTag"
                  style={{ color: item.color, borderColor: `${item.color}40` }}
                >
                  {item.tag}
                </span>
                <span className="askArrow" aria-hidden="true">Ask →</span>
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
                <Icon name={item.icon} size={18} className="itemIcon" />
                <span
                  className="itemTag"
                  style={{ color: item.color, borderColor: `${item.color}40` }}
                >
                  {item.tag}
                </span>
                <span className="askArrow" aria-hidden="true">Ask →</span>
              </div>
              <p className="cardQuestion">{item.question}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

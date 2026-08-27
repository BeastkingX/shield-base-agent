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
    color: "#f43f5e",
  },
  {
    icon: "⚡",
    tag: "EIP-7702",
    question: "What is EIP-7702 and how does it upgrade wallets on Base?",
    color: "#8b5cf6",
  },
  {
    icon: "🔍",
    tag: "Case Study",
    question: "How did the $23.75M Ostium hack happen without a smart contract bug?",
    color: "#f59e0b",
  },
  {
    icon: "🔒",
    tag: "Approvals",
    question: "Why are unlimited token approvals (uint256.max) dangerous?",
    color: "#0052ff",
  },
  {
    icon: "🍯",
    tag: "Scam Detection",
    question: "How do I recognize a honeypot token or fake airdrop on Base?",
    color: "#10b981",
  },
  {
    icon: "🛡️",
    tag: "Money Trail",
    question: "How does Shield's 2-hop traversal catch brand new burner wallets?",
    color: "#06b6d4",
  },
];

export default function AiEducationCarousel({ onSelectQuestion }: AiEducationCarouselProps) {
  return (
    <div className="educationCarouselSection">
      <div className="carouselHeaderRow">
        <div className="carouselTitleGroup">
          <span className="sparkleIcon">✨</span>
          <span className="carouselHeading">Interactive Security Intelligence</span>
          <span className="carouselSubTag">Click any topic to ask Shield AI</span>
        </div>
      </div>

      <div className="carouselTrackWrapper">
        <div className="carouselTrack">
          {/* Repeat twice for smooth continuous scrolling loop */}
          {[...SECURITY_QUESTIONS, ...SECURITY_QUESTIONS].map((item, index) => (
            <button
              key={index}
              type="button"
              className="carouselCardBtn"
              onClick={() => onSelectQuestion(item.question)}
            >
              <div className="cardTopLine">
                <span className="itemIcon">{item.icon}</span>
                <span
                  className="itemTag"
                  style={{ color: item.color, borderColor: `${item.color}30` }}
                >
                  {item.tag}
                </span>
                <span className="askArrow">Ask ↗</span>
              </div>
              <p className="cardQuestion">{item.question}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

module.exports = {
  ci: {
    collect: {
      staticDistDir: ".",
      url: [
        "http://localhost:3000/",
        "http://localhost:3000/chatgpt-plus-virtual-card/",
        "http://localhost:3000/netflix-virtual-card/",
        "http://localhost:3000/usdt-to-virtual-card/",
        "http://localhost:3000/apple-pay-virtual-card/",
        "http://localhost:3000/crypto-virtual-card/"
      ],
      numberOfRuns: 1,
      settings: {
        onlyCategories: ["seo", "accessibility", "best-practices"]
      }
    },
    assert: {
      assertions: {
        "categories:seo": ["error", { minScore: 0.9 }],
        "categories:accessibility": ["warn", { minScore: 0.8 }],
        "categories:best-practices": ["warn", { minScore: 0.8 }],
        "document-title": "error",
        "meta-description": "error",
        "canonical": "error",
        "hreflang": "off"
      }
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci"
    }
  }
};

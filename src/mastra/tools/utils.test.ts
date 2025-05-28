import { formatSections } from './utils';
import { Section } from '../types'; // Assuming Section type is exported from types

// Note: This test file uses Jest-like syntax. A test runner (e.g., Jest, Vitest)
// needs to be set up in the project to execute these tests.

describe('formatSections', () => {
  it('should return an empty string for an empty array of sections', () => {
    const sections: Section[] = [];
    expect(formatSections(sections)).toBe("");
  });

  it('should correctly format a single section', () => {
    const sections: Section[] = [
      {
        name: "Introduction",
        description: "This is the introduction.",
        research: false,
        content: "Introduction content goes here.",
        sources: []
      }
    ];
    const expectedOutput = `
============================================================
Section 1: Introduction
============================================================
Description:
This is the introduction.
Requires Research:
false

Content:
Introduction content goes here.

`;
    expect(formatSections(sections)).toBe(expectedOutput);
  });

  it('should correctly format multiple sections', () => {
    const sections: Section[] = [
      {
        name: "Section 1",
        description: "Description for section 1.",
        research: true,
        content: "Content for section 1.",
        sources: [{ title: "Source 1", url: "http://example.com/s1" }]
      },
      {
        name: "Section 2",
        description: "Description for section 2.",
        research: false,
        content: "Content for section 2.",
        // sources intentionally omitted or empty
      }
    ];
    const expectedOutput = `
============================================================
Section 1: Section 1
============================================================
Description:
Description for section 1.
Requires Research:
true

Content:
Content for section 1.

` + `
============================================================
Section 2: Section 2
============================================================
Description:
Description for section 2.
Requires Research:
false

Content:
Content for section 2.

`;
    expect(formatSections(sections)).toBe(expectedOutput);
  });

  it('should show "[Not yet written]" for sections with no content', () => {
    const sections: Section[] = [
      {
        name: "Future Section",
        description: "This section is planned.",
        research: true,
        // content is undefined
        sources: []
      }
    ];
    const expectedOutput = `
============================================================
Section 1: Future Section
============================================================
Description:
This section is planned.
Requires Research:
true

Content:
[Not yet written]

`;
    expect(formatSections(sections)).toBe(expectedOutput);
  });
});

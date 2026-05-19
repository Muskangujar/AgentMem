// core/cpp/tokenizer.h
//
// Header-only WordPiece tokenizer compatible with BERT / bge-small-en-v1.5.
//
// Implements:
//   BasicTokenizer — lowercase, strip Unicode combining marks (accent removal),
//                    space-pad CJK characters, split on whitespace and punctuation.
//   WordPieceTokenizer — greedy longest-prefix subword matching against vocab.txt.
//
// Cross-platform: pure C++17 standard library only — no external dependencies.
//
// Usage:
//   WordPieceTokenizer tok;
//   if (tok.load("/models/bge-small-en-v1.5/vocab.txt")) {
//       auto ids = tok.tokenize("Hello, world!", 512);
//       // ids = [101, ..., 102]  ([CLS] ... [SEP])
//   }
//
// If vocab.txt is not loaded, callers should fall back to an alternative
// token-ID scheme (e.g. FNV-1a hash projection) so stub/test mode still works.

#pragma once

#include <algorithm>
#include <cstdint>
#include <fstream>
#include <string>
#include <unordered_map>
#include <vector>

namespace agentmem {

class WordPieceTokenizer {
public:
    // Standard BERT vocabulary special token IDs.
    static constexpr int64_t PAD_ID = 0;
    static constexpr int64_t UNK_ID = 100;
    static constexpr int64_t CLS_ID = 101;
    static constexpr int64_t SEP_ID = 102;

    // Words whose byte-length exceeds this threshold map directly to [UNK].
    static constexpr size_t MAX_CHARS_PER_WORD = 100;

    WordPieceTokenizer() = default;

    /// Load vocabulary from a vocab.txt file.
    /// Each line is one token; the 0-based line index is the token ID.
    /// Returns true on success, false if the file cannot be opened.
    bool load(const std::string& vocab_path) {
        std::ifstream in(vocab_path);
        if (!in.is_open()) return false;

        vocab_.clear();
        std::string line;
        int64_t id = 0;
        while (std::getline(in, line)) {
            // Strip trailing \r for Windows-style CRLF line endings.
            if (!line.empty() && line.back() == '\r') line.pop_back();
            if (!line.empty()) vocab_[line] = id;
            ++id;
        }
        loaded_ = !vocab_.empty();
        return loaded_;
    }

    bool is_loaded() const { return loaded_; }
    size_t vocab_size() const { return vocab_.size(); }

    /// Tokenize UTF-8 text into BERT token IDs.
    /// Output is: [CLS] subword_ids... [SEP], capped at max_len total tokens.
    std::vector<int64_t> tokenize(const std::string& text, size_t max_len = 512) const {
        std::vector<int64_t> ids;
        ids.reserve(std::min(text.size() / 4 + 4, max_len));
        ids.push_back(CLS_ID);

        std::vector<std::string> words = basic_tokenize(text);
        for (const auto& word : words) {
            if (ids.size() >= max_len - 1) break;
            std::vector<int64_t> sub = wordpiece(word);
            for (int64_t wid : sub) {
                if (ids.size() >= max_len - 1) break;
                ids.push_back(wid);
            }
        }
        ids.push_back(SEP_ID);
        return ids;
    }

private:
    std::unordered_map<std::string, int64_t> vocab_;
    bool loaded_ = false;

    // ── UTF-8 helpers ─────────────────────────────────────────────────────────

    /// Decode one Unicode codepoint from UTF-8 string s at byte index i.
    /// Advances i past the consumed bytes.
    /// Returns U+FFFD on invalid byte sequences.
    static uint32_t next_cp(const std::string& s, size_t& i) {
        if (i >= s.size()) return 0;
        uint8_t b0 = static_cast<uint8_t>(s[i]);
        uint32_t cp;
        size_t extra;

        if      (b0 < 0x80) { cp = b0;        extra = 0; }
        else if (b0 < 0xC0) { ++i; return 0xFFFD; } // stray continuation byte
        else if (b0 < 0xE0) { cp = b0 & 0x1F; extra = 1; }
        else if (b0 < 0xF0) { cp = b0 & 0x0F; extra = 2; }
        else if (b0 < 0xF8) { cp = b0 & 0x07; extra = 3; }
        else                { ++i; return 0xFFFD; }

        ++i;
        for (size_t k = 0; k < extra; ++k, ++i) {
            if (i >= s.size()) return 0xFFFD;
            uint8_t b = static_cast<uint8_t>(s[i]);
            if ((b & 0xC0) != 0x80) return 0xFFFD; // invalid continuation
            cp = (cp << 6) | (b & 0x3F);
        }
        return cp;
    }

    /// Encode a Unicode codepoint to UTF-8.
    static std::string cp_to_utf8(uint32_t cp) {
        std::string out;
        if (cp < 0x80) {
            out += static_cast<char>(cp);
        } else if (cp < 0x800) {
            out += static_cast<char>(0xC0 | (cp >> 6));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else if (cp < 0x10000) {
            out += static_cast<char>(0xE0 | (cp >> 12));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        } else {
            out += static_cast<char>(0xF0 | (cp >> 18));
            out += static_cast<char>(0x80 | ((cp >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((cp >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (cp & 0x3F));
        }
        return out;
    }

    // ── Character classification (per BERT tokenizer spec) ────────────────────

    static bool is_whitespace(uint32_t cp) {
        return cp == ' ' || cp == '\t' || cp == '\n' || cp == '\r' ||
               cp == 0x00A0 || cp == 0x2028 || cp == 0x2029;
    }

    /// Unicode combining characters (Category Mn) — stripped for accent removal.
    static bool is_combining_mark(uint32_t cp) {
        return (cp >= 0x0300  && cp <= 0x036F)  ||  // Combining Diacritical Marks
               (cp >= 0x1AB0  && cp <= 0x1AFF)  ||  // Combining Diacritical Marks Extended
               (cp >= 0x1DC0  && cp <= 0x1DFF)  ||  // Combining Diacritical Marks Supplement
               (cp >= 0x20D0  && cp <= 0x20FF)  ||  // Combining Diacritical Marks for Symbols
               (cp >= 0xFE20  && cp <= 0xFE2F);     // Combining Half Marks
    }

    /// CJK Unified Ideographs and extensions — receive extra whitespace padding.
    static bool is_cjk(uint32_t cp) {
        return (cp >= 0x4E00  && cp <= 0x9FFF)  ||
               (cp >= 0x3400  && cp <= 0x4DBF)  ||
               (cp >= 0x20000 && cp <= 0x2A6DF) ||
               (cp >= 0x2A700 && cp <= 0x2B73F) ||
               (cp >= 0x2B740 && cp <= 0x2B81F) ||
               (cp >= 0x2B820 && cp <= 0x2CEAF) ||
               (cp >= 0xF900  && cp <= 0xFAFF)  ||
               (cp >= 0x2F800 && cp <= 0x2FA1F);
    }

    /// ASCII and common Unicode punctuation (per BERT BasicTokenizer).
    static bool is_punctuation(uint32_t cp) {
        if (cp >= 33  && cp <= 47)  return true; // ! " # $ % & ' ( ) * + , - . /
        if (cp >= 58  && cp <= 64)  return true; // : ; < = > ? @
        if (cp >= 91  && cp <= 96)  return true; // [ \ ] ^ _ `
        if (cp >= 123 && cp <= 126) return true; // { | } ~
        if (cp >= 0x2000 && cp <= 0x206F) return true; // General Punctuation block
        if (cp >= 0x2E00 && cp <= 0x2E7F) return true; // Supplemental Punctuation
        if (cp >= 0x3000 && cp <= 0x303F) return true; // CJK Symbols and Punctuation
        return false;
    }

    /// ASCII-range lowercase. Sufficient for English BERT models (do_lower_case=true).
    static uint32_t to_lower_cp(uint32_t cp) {
        if (cp >= 'A' && cp <= 'Z') return cp + 32;
        return cp;
    }

    // ── BasicTokenizer ────────────────────────────────────────────────────────

    /// Applies BERT BasicTokenizer normalization and whitespace/punctuation splitting:
    ///   1. Lowercase (ASCII range)
    ///   2. Strip Unicode combining marks (accent removal for NFD-like cleanup)
    ///   3. Space-pad CJK characters so they tokenize as individual tokens
    ///   4. Split on whitespace and punctuation boundaries
    std::vector<std::string> basic_tokenize(const std::string& text) const {
        // Pass 1: codepoint-level normalization into a flat UTF-8 string.
        std::string normalized;
        normalized.reserve(text.size());
        for (size_t i = 0; i < text.size(); ) {
            uint32_t cp = next_cp(text, i);
            if (cp == 0 || cp == 0xFFFD) continue;
            if (is_combining_mark(cp))    continue; // strip accent combining marks
            uint32_t lc = to_lower_cp(cp);
            if (is_cjk(lc)) {
                normalized += ' ';
                normalized += cp_to_utf8(lc);
                normalized += ' ';
            } else {
                normalized += cp_to_utf8(lc);
            }
        }

        // Pass 2: split on whitespace and punctuation boundaries.
        std::vector<std::string> words;
        std::string cur;
        for (size_t i = 0; i < normalized.size(); ) {
            uint32_t cp = next_cp(normalized, i);
            if (is_whitespace(cp)) {
                if (!cur.empty()) { words.push_back(std::move(cur)); cur.clear(); }
            } else if (is_punctuation(cp)) {
                if (!cur.empty()) { words.push_back(std::move(cur)); cur.clear(); }
                words.push_back(cp_to_utf8(cp));
            } else {
                cur += cp_to_utf8(cp);
            }
        }
        if (!cur.empty()) words.push_back(std::move(cur));
        return words;
    }

    // ── WordPiece ─────────────────────────────────────────────────────────────

    /// Greedy longest-prefix WordPiece segmentation.
    ///
    /// For each position in the word, finds the longest prefix present in vocab_.
    /// Continuation subwords are prefixed with "##" (standard BERT convention).
    /// Words longer than MAX_CHARS_PER_WORD, or where any segment has no vocab
    /// match, produce a single [UNK] token.
    std::vector<int64_t> wordpiece(const std::string& word) const {
        if (word.size() > MAX_CHARS_PER_WORD) return {UNK_ID};

        std::vector<int64_t> sub_ids;
        size_t start = 0;

        while (start < word.size()) {
            size_t end = word.size();
            bool found = false;

            while (end > start) {
                std::string sub;
                if (start > 0) sub = "##";
                sub += word.substr(start, end - start);

                auto it = vocab_.find(sub);
                if (it != vocab_.end()) {
                    sub_ids.push_back(it->second);
                    found = true;
                    start = end;
                    break;
                }

                // Step back exactly one UTF-8 character (skip continuation bytes).
                --end;
                while (end > start &&
                       (static_cast<uint8_t>(word[end]) & 0xC0) == 0x80) {
                    --end;
                }
            }

            if (!found) return {UNK_ID};
        }

        return sub_ids.empty() ? std::vector<int64_t>{UNK_ID} : sub_ids;
    }
};

} // namespace agentmem

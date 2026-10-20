import test from "node:test";
import assert from "node:assert/strict";
import {
  isRecordKeyPattern,
  recordKeyMatches,
  recordKeyPlaceholders,
} from "../src/lib/key-pattern.ts";

test("record placeholder names and matching share the named-placeholder grammar", () => {
  assert.deepEqual(recordKeyPlaceholders("ap:{owner_id}:{Item2}:{owner_id}:{bad-name}:{0bad}"), ["owner_id", "Item2", "owner_id"]);
  assert.deepEqual(recordKeyPlaceholders("literal.{bad-name}"), []);
  assert.equal(recordKeyMatches("a.[b]+\\/{id}:{part_2}", "a.[b]+\\/你好:tail"), true);
  assert.equal(recordKeyMatches("a.[b]+\\/{id}:{part_2}", "axb/你好:tail"), false);
  assert.equal(recordKeyMatches("key:{id}", "key:"), false);
  assert.equal(recordKeyMatches("literal.{bad-name}", "literal.{bad-name}"), true);
  assert.equal(isRecordKeyPattern("{0bad}"), false);
  assert.equal(isRecordKeyPattern("auth:session:{id}"), true);
  assert.equal(isRecordKeyPattern("ap:followers"), false);
});

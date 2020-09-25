CREATE TABLE "boards" (
  "board_id" serial PRIMARY KEY,
  "board_slug" text,
  "board_name" text,
  "board_item_name" text,
  "board_description" text,
  "board_max_votes" int
);

CREATE TABLE "items" (
  "item_id" serial PRIMARY KEY,
  "board_id" integer,
  "item_name" text
);

CREATE TABLE "votes" (
  "vote_id" serial PRIMARY KEY,
  "board_id" integer,
  "item_id" integer,
  "user_id" text
);

CREATE TABLE "users" (
  "user_id" text PRIMARY KEY,
  "admin" boolean
);

ALTER TABLE "items" ADD FOREIGN KEY ("board_id") REFERENCES "boards" ("board_id") ON DELETE CASCADE;

ALTER TABLE "votes" ADD FOREIGN KEY ("board_id") REFERENCES "boards" ("board_id") ON DELETE CASCADE;

ALTER TABLE "votes" ADD FOREIGN KEY ("item_id") REFERENCES "items" ("item_id") ON DELETE CASCADE;


-- connect-pg-simple schema --
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
	"sess" json NOT NULL,
	"expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);

ALTER TABLE "session" ADD CONSTRAINT "session_pkey" PRIMARY KEY ("sid") NOT DEFERRABLE INITIALLY IMMEDIATE;

CREATE INDEX "IDX_session_expire" ON "session" ("expire");
-- connect-pg-simple schema --


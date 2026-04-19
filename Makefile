.PHONY: install run dev-api dev-web test typecheck build

install:
	npm install

run:
	./run.sh

dev-api:
	npm run dev:api

dev-web:
	npm run dev:web

test:
	npm test

typecheck:
	npm run typecheck

build:
	npm run build

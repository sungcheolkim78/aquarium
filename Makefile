.PHONY: help install dev test build preview check

help:
	@printf '%s\n' \
		'make install  Install web dependencies' \
		'make dev      Start the Vite development server' \
		'make test     Run the test suite' \
		'make build    Type-check and create a production build' \
		'make preview  Preview the production build' \
		'make check    Run tests and the production build'

install:
	npm --prefix web install

dev:
	npm --prefix web run dev

test:
	npm --prefix web run test

build:
	npm --prefix web run build

preview:
	npm --prefix web run preview

check: test build

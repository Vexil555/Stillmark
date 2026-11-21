import sys

if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "--guard":
        from desktop.guard import supervise

        supervise(int(sys.argv[2]), sys.argv[3])
    else:
        from desktop.window import run

        sys.exit(run())

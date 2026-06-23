import os
import sys
import subprocess

def run(cmd):
    """Run a manage.py command, exit on failure."""
    result = subprocess.run([sys.executable, "manage.py"] + cmd)
    if result.returncode != 0:
        sys.exit(result.returncode)

def main():
    print("Starting Django backend...")

    if os.environ.get("ENABLE_MIGRATE") == "true":
        print("Running migrations...")
        run(["migrate"])

    if os.environ.get("ENABLE_COLLECTSTATIC") == "true":
        print("Collecting static files...")
        run(["collectstatic", "--noinput"])

    username = os.environ.get("DJANGO_SUPERUSER_USERNAME")
    if username:
        print("Creating superuser...")
        email = os.environ.get("DJANGO_SUPERUSER_EMAIL", "")
        subprocess.run(
            [sys.executable, "manage.py", "createsuperuser",
             "--noinput", "--username", username, "--email", email]
        )

    if os.environ.get("ENABLE_SEED") == "true":
        print("Seeding database...")
        run(["shell", "--command", "exec(open('seed.py').read())"])

    print("Starting server...")
    args = sys.argv[1:]
    if not args:
        args = ["gunicorn", "backend.wsgi:application", "--bind", "0.0.0.0:8000"]
    os.execvp(args[0], args)

if __name__ == "__main__":
    main()

import os
from dotenv import load_dotenv

# Environment variables
# Load and assign environment variables to be imported throughout application
load_dotenv()

# Vonage
VONAGE_APPLICATION_ID = os.getenv("VONAGE_APPLICATION_ID")
VONAGE_PRIVATE_KEY_PATH = os.getenv("VONAGE_PRIVATE_KEY_PATH", "private.key")
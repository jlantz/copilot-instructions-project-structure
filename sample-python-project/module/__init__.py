def sample_function():
    print("This is a sample function")

def another_function():
    print("This is another function")

class SampleClass:
    def __init__(self):
        print("This is a sample class")

sample_variable = "This is a sample variable"

from .submodule import SampleClass

__all__ = ['SampleClass']

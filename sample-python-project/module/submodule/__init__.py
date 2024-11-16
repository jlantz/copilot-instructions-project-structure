from .subfile import MyTest

def sample_function():
    print("This is a sample function")

def another_function():
    print("This is another function")

class SampleClass:
    def __init__(self):
        print("This is a sample class")

sample_variable = "This is a sample variable"

__all__ = ['sample_function', 'another_function', 'SampleClass', 'sample_variable', 'MyTest']

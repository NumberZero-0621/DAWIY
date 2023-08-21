#include "MainComponent.h"

//==============================================================================
MainComponent::MainComponent()
{
    setSize(1280, 720);
    addAndMakeVisible(editor);
    editor.setup(10, 900, 20); //default 10 bars, with 900 pixels per bar (width) and 20 pixels per step (each note height)

    editor.sendChange = [](int note, int velocity)
        {
            // You will probably want to send this information to some kind of MIDI messaging system
            std::cout << "MIDI send: " << note << " : " << velocity << "\n";
        };
    tickTest = 0;
    startTimer(20);
}

MainComponent::~MainComponent()
{
}

//==============================================================================
void MainComponent::paint (juce::Graphics& g)
{
    // (Our component is opaque, so we must completely fill the background with a solid colour)
    g.fillAll (getLookAndFeel().findColour (juce::ResizableWindow::backgroundColourId));

    g.setFont (juce::Font (16.0f));
    g.setColour (juce::Colours::white);
    g.drawText ("Hello World!", getLocalBounds(), juce::Justification::centred, true);
}

void MainComponent::resized()
{
    editor.setBounds(0, 0, getWidth(), getHeight());
    // This is called when the MainComponent is resized.
    // If you add any child components, this is where you should
    // update their positions.
}

void MainComponent::timerCallback()
{
    tickTest += 20;
    editor.setPlaybackMarkerPosition(tickTest);
    if (tickTest >= 480 * 4 * 10) {
        tickTest = 0;
    }
}
